/**
 * 后端测试。
 *
 * 全部用临时目录 + 假 mp4（内容就是字节序列，媒体类型只靠扩展名判定），
 * 不碰真实视频目录，也不依赖 ffprobe。
 *
 * 关于类型（原来这里是 6 条 `@ts-expect-error`）：
 *   后端是纯 ESM 的 `.mjs`，且 `server/**` 不属于本文件能改的范围，没法补 JSDoc。
 *   现在 `tsconfig.node.json` 打开了 `allowJs: true`（`checkJs: false`，
 *   所以 TS 只负责解析、不检查 .mjs 内部），`.mjs` 导入不再是「找不到模块」，
 *   那 6 条 `@ts-expect-error` 就变成了 TS2578「未使用的抑制指令」，必须删掉。
 *   但纯 JS 推导出来的类型很弱（对象字面量会退化成 `object` / `unknown`，
 *   无参函数的形参是隐式 any），直接用会把 100 多处调用点染成 any。
 *   所以这里在导入处显式声明一份「后端对外契约」的本地类型再窄化一次：
 *   下游所有断言（body / base / a / d 之类）因此都能拿到真实类型并被 strict 检查，
 *   而不是靠 any 蒙混过关。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fsp } from 'node:fs';
import { execFile } from 'node:child_process';
import http, { type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createServer as createServerRaw } from '../../server.mjs';
import { makeVideoId, normalizeRelativePath, isValidVideoId } from '../../server/ids.mjs';
import { isVideoFileName, scanVideoRoot as scanVideoRootRaw, splitExtension, describeSkippedVideoFile } from '../../server/catalog-scan.mjs';
import {
  loadAnnotations as loadAnnotationsRaw,
  titleFromRelativePath,
  resolveDefaultTypes,
  findAnnotation,
} from '../../server/annotations.mjs';
import { escapeRelativePath } from '../../server/ids.mjs';
import { buildRangeResponse as buildRangeResponseRaw, contentTypeFor, parseRange as parseRangeRaw } from '../../server/http-range.mjs';
import { checkVideoRoot } from '../../server/config.mjs';
import { loadDurationCache as loadDurationCacheRaw } from '../../server/duration-cache.mjs';
import { buildVideoList as buildVideoListRaw } from '../../server/catalog-build.mjs';
import {
  MISSING_DURATION_MESSAGE,
  mergeDurationsIntoCache,
  missingDurationDiagnostic,
  probeDurations,
  probeEnvironment,
  resetProbeAvailability,
  summarizeMissingDurations,
} from '../../server/duration-probe.mjs';

/* ------------------------------------------------------------------ *
 * 后端对外契约的本地类型（.mjs 无 JSDoc 时 TS 推不出来，这里补上）
 * ------------------------------------------------------------------ */

interface ScanEntry {
  id: string;
  relativePath: string;
  absolutePath: string;
  size: number;
}

interface Diagnostic {
  path: string;
  kind: 'unreadable' | 'missing' | 'duplicate' | 'metadata' | 'hidden';
  message: string;
}

interface ScanResult {
  root: string;
  rootAvailable: boolean;
  videos: ScanEntry[];
  diagnostics: Diagnostic[];
}

interface Annotation {
  title?: string;
  types: string[];
  level?: 'K1' | 'K2' | 'K3' | 'K4' | 'K5';
}

interface AnnotationBundle {
  present: boolean;
  videos: Map<string, Annotation>;
  /** 部署态（转义后）键 → 标注；含 sourceKey 是为了撞键时能指出是哪两条撞了。 */
  videosByTarget: Map<string, { sourceKey: string; entry: Annotation }>;
  defaultTypes: Map<string, string[]>;
  defaultTypesByTarget: Map<string, string[]>;
  diagnostics: Diagnostic[];
}

type ParsedRange = { type: 'full' } | { type: 'range'; start: number; end: number } | { type: 'multi' } | { type: 'unsatisfiable' };

interface ServerOptions {
  env: {
    VIDEO_ROOT: string;
    ANNOTATIONS_FILE: string;
    THUMBNAIL_DIR: string;
    DIST_DIR: string;
  };
}

/** loadDurationCache 的返回形状（.mjs 无 JSDoc，这里显式声明一份）。 */
interface DurationCache {
  file: string;
  present: boolean;
  map: Map<string, number>;
  diagnostics: Diagnostic[];
}

/** duration-probe 里几个纯函数/后台任务，本文件用到的返回形状。 */
type ProbeEnvironment = { ffprobe: 'unknown' | 'ok' | 'missing' | 'broken'; cacheWritable: 'unknown' | 'ok' | 'read-only' | 'error'; detail: string };
type MergeResult = 'written' | 'unchanged' | 'readonly' | 'error';

/** /api/videos 与 /api/rescan 的响应体形状，跟 catalog 对齐。 */
interface ApiVideo {
  id: string;
  relativePath: string;
  title: string;
  types: string[];
  level: 'K1' | 'K2' | 'K3' | 'K4' | 'K5' | null;
  durationSeconds: number;
  hasThumbnail: boolean;
  available: boolean;
  playbackUrl: string;
  thumbnailUrl: string;
}

interface ApiPayload {
  ok: boolean;
  videoCount: number;
  annotationCount: number;
  diagnosticCount: number;
  videoRootAvailable: boolean;
  generatedAt: string;
  videos: ApiVideo[];
  diagnostics: Diagnostic[];
  error: string;
}

const scanVideoRoot = scanVideoRootRaw as (root: string) => Promise<ScanResult>;
const loadAnnotations = loadAnnotationsRaw as (file: string) => Promise<AnnotationBundle>;
const find = findAnnotation as (annotations: AnnotationBundle, relativePath: string) => Annotation | null;
const parseRange = parseRangeRaw as (header: string | undefined, size: number) => ParsedRange;
const buildRangeResponse = buildRangeResponseRaw as (
  range: ParsedRange,
  size: number,
  contentType: string,
) => { status: number; headers: Record<string, string> };
const createServer = createServerRaw as (options: ServerOptions) => Server;
const loadDurationCache = loadDurationCacheRaw as (file: string) => Promise<DurationCache>;
const probeEnvRaw = probeEnvironment as () => ProbeEnvironment;
const mergeDurations = mergeDurationsIntoCache as (file: string, found: Map<string, number>) => Promise<MergeResult>;
const summarizeRaw = summarizeMissingDurations as (
  diagnostics: Diagnostic[],
  options?: { environment?: ProbeEnvironment; cacheFile?: string },
) => Diagnostic[];
const missingDiagnosticRaw = missingDurationDiagnostic as (input: {
  total: number;
  environment?: ProbeEnvironment;
  cacheFile?: string;
}) => Diagnostic;
const execFileAsync = promisify(execFile);

/** buildVideoList 的返回形状与入参（.mjs 无 JSDoc，这里显式声明一份）。 */
interface BuiltVideo { relativePath: string; durationSeconds: number; available: boolean }
interface BuiltCatalog { videos: BuiltVideo[]; diagnostics: Diagnostic[] }
const buildVideoList = buildVideoListRaw as (input: {
  scanned: { videos: ScanEntry[]; diagnostics: Diagnostic[] };
  annotations: AnnotationBundle;
  durations: { map: Map<string, number>; file?: string };
  thumbnailDir: string;
}) => Promise<BuiltCatalog>;

const SIZE = 1000;
/** 内容可预测的假视频：第 i 个字节等于 i % 251，范围测试直接比对字节即可。 */
const VIDEO_BYTES = Buffer.from(Array.from({ length: SIZE }, (_, i) => i % 251));

const tempRoots: string[] = [];

async function makeTempDir(prefix = 'p038-server-') {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

async function writeFile(target: string, content: string | Uint8Array = 'x') {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, content);
}

/** listen(0) 之后拿真实端口；拿不到就是环境不对，直接炸出来而不是静默串到别的服务。 */
function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('server.address() 没有返回 TCP 地址');
  }
  return address.port;
}

/** 统一取 JSON：把 unknown 收窄成上面那份 API 契约。 */
async function getJson(url: string, init?: RequestInit): Promise<ApiPayload> {
  return (await (await fetch(url, init)).json()) as ApiPayload;
}

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fsp.rm(dir, { recursive: true, force: true })));
});

/* ------------------------------------------------------------------ *
 * 基础：id 生成
 * ------------------------------------------------------------------ */

describe('id 生成规则', () => {
  it('同样的相对路径永远得到同样的 id', () => {
    expect(makeVideoId('a/b.mp4')).toBe(makeVideoId('a/b.mp4'));
  });

  it('只有 16 位小写十六进制', () => {
    expect(makeVideoId('a/b.mp4')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('NFC 归一化后等价的写法得到同一个 id', () => {
    const composed = 'café/拉伸.mp4'; // e + combining acute
    const precomposed = 'café/拉伸.mp4';
    expect(makeVideoId(composed)).toBe(makeVideoId(precomposed));
  });

  it('反斜杠与前导 ./ 会被规范化掉', () => {
    expect(normalizeRelativePath('.\\a\\b.mp4')).toBe('a/b.mp4');
    expect(makeVideoId('./a/b.mp4')).toBe(makeVideoId('a/b.mp4'));
  });

  it('改名 = 新 id（刻意行为）', () => {
    expect(makeVideoId('a/old.mp4')).not.toBe(makeVideoId('a/new.mp4'));
  });

  it('只放行 16 位十六进制的 id', () => {
    expect(isValidVideoId(makeVideoId('a/b.mp4'))).toBe(true);
    expect(isValidVideoId('../etc/passwd')).toBe(false);
    expect(isValidVideoId('/etc/passwd')).toBe(false);
    expect(isValidVideoId('')).toBe(false);
    expect(isValidVideoId('ABCDEF0123456789')).toBe(false); // 大写
    expect(isValidVideoId('abc')).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * A1 目录扫描
 * ------------------------------------------------------------------ */

describe('目录扫描', () => {
  it('收集中文、空格、】、全角／等特殊字符的文件名', async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, 'keep】晨起唤醒', '01 20 分钟晨起唤醒·消除肩颈腰背酸痛·清晨瑜伽.mp4'));
    await writeFile(path.join(root, '带 空格 的 目录', 'hello world.mp4'));
    await writeFile(path.join(root, '全角／目录／子目录', '全角斜杠视频.mp4'));
    await writeFile(path.join(root, '管道丨竖线', 'a+b=c(1).mp4'));

    const { videos } = await scanVideoRoot(root);
    const names = videos.map((v) => v.relativePath);
    expect(names).toHaveLength(4);
    expect(names).toContain('keep】晨起唤醒/01 20 分钟晨起唤醒·消除肩颈腰背酸痛·清晨瑜伽.mp4');
    expect(names).toContain('带 空格 的 目录/hello world.mp4');
    expect(names).toContain('全角／目录／子目录/全角斜杠视频.mp4');
    expect(names).toContain('管道丨竖线/a+b=c(1).mp4');
    // 相对路径必须是 posix 分隔符，不能出现反斜杠。
    expect(names.every((n) => !n.includes('\\'))).toBe(true);
  });

  it('id 去重按规范化后的路径：NFC 等价写法算同一个 id', () => {
    expect(makeVideoId('d/e\u0301/x.mp4')).toBe(makeVideoId('d/\u00e9/x.mp4'));
  });

  it('同名文件在不同目录得到不同 id', async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, 'A', '热身.mp4'), 'aaa');
    await writeFile(path.join(root, 'B', '热身.mp4'), 'bbb');

    const { videos } = await scanVideoRoot(root);
    expect(videos).toHaveLength(2);
    expect(videos[0].id).not.toBe(videos[1].id);
  });

  it('排除 .tmp.mp4 / 隐藏文件 / ~$ 锁文件 / AppleDouble', () => {
    expect(isVideoFileName('正常.mp4')).toBe(true);
    expect(isVideoFileName('A.MOV')).toBe(true);
    expect(isVideoFileName('B.m4v')).toBe(true);
    // 关键回归：扩展名看起来是 .mp4，但其实是没写完的转存产物
    expect(isVideoFileName('04 20 分钟晨起唤醒·清晨瑜伽.mp4.tmp.mp4')).toBe(false);
    expect(isVideoFileName('.hidden.mp4')).toBe(false);
    expect(isVideoFileName('~$草稿.mp4')).toBe(false);
    expect(isVideoFileName('._资源分叉.mp4')).toBe(false);
    expect(isVideoFileName('说明.txt')).toBe(false);
  });

  it('坏 .tmp.mp4 不进目录，但必须留下诊断（FR-001「坏文件记录诊断信息」）', async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, 'keep】晨起唤醒', '04 20 分钟晨起唤醒·清晨瑜伽.mp4.tmp.mp4'));
    await writeFile(path.join(root, 'keep】晨起唤醒', '01 正常视频.mp4'));

    const result = await scanVideoRoot(root);
    expect(result.videos.map((v) => v.relativePath)).toEqual(['keep】晨起唤醒/01 正常视频.mp4']);
    expect(result.diagnostics).toEqual([
      {
        path: 'keep】晨起唤醒/04 20 分钟晨起唤醒·清晨瑜伽.mp4.tmp.mp4',
        kind: 'unreadable',
        message: '文件名含 .tmp.，疑似未写完的转存产物（下载或拷贝中途断开），已跳过',
      },
    ]);
    // 诊断里的 path 必须是相对路径，绝不能泄漏绝对路径（它会原样发给浏览器）。
    expect(JSON.stringify(result.diagnostics)).not.toContain(root);
  });

  it('「像视频却被排除」记诊断，「根本不是视频」静默忽略（否则每个无关文件都是噪音）', async () => {
    const root = await makeTempDir();
    // 三个「看起来是视频」的被排除文件
    await writeFile(path.join(root, 'keep】晨起唤醒', '04 坏文件.mp4.tmp.mp4'));
    await writeFile(path.join(root, '.隐藏视频.mp4'));
    await writeFile(path.join(root, '~$锁文件.mp4'));
    await writeFile(path.join(root, '._AppleDouble.mp4'));
    // 一堆「根本不是视频」的无关文件
    await writeFile(path.join(root, 'keep】/说明.txt'));
    await writeFile(path.join(root, 'keep】/封面.jpg'));
    await writeFile(path.join(root, '.DS_Store'));
    await writeFile(path.join(root, '真正的临时文件.mp4.tmp'));
    await writeFile(path.join(root, '1 正常视频.mp4'));

    const result = await scanVideoRoot(root);
    expect(result.videos.map((v) => v.relativePath)).toEqual(['1 正常视频.mp4']);
    const paths = result.diagnostics.map((d) => d.path).sort();
    expect(paths).toEqual(['._AppleDouble.mp4', '.隐藏视频.mp4', 'keep】晨起唤醒/04 坏文件.mp4.tmp.mp4', '~$锁文件.mp4']);
    // .tmp. 是真·坏视频 → unreadable；隐藏/锁文件/伴生文件本来就不是视频本体 → hidden
    expect(result.diagnostics.find((d) => d.path.includes('.tmp.'))?.kind).toBe('unreadable');
    expect(result.diagnostics.filter((d) => d.kind === 'hidden')).toHaveLength(3);
    for (const d of result.diagnostics) {
      expect(Object.keys(d).sort()).toEqual(['kind', 'message', 'path']);
      // 中文说明，家人看得懂
      expect(d.message).toMatch(/[一-鿿]/);
    }
  });

  it('describeSkippedVideoFile 的判定只看最后一个扩展名', () => {
    // 最后一个扩展名是视频容器 → 值得记诊断
    expect(describeSkippedVideoFile('a.mp4.tmp.mp4')?.kind).toBe('unreadable');
    expect(describeSkippedVideoFile('a.m4v.tmp.mp4')?.kind).toBe('unreadable');
    expect(describeSkippedVideoFile('a.mov.tmp.mp4')?.kind).toBe('unreadable');
    expect(describeSkippedVideoFile('a.mov.tmp.mp4')?.kind).toBe('unreadable');
    // 最后一个扩展名不是视频容器 → 根本不是视频，静默忽略
    expect(describeSkippedVideoFile('说明.txt')).toBeNull();
    expect(describeSkippedVideoFile('封面.jpg')).toBeNull();
    expect(describeSkippedVideoFile('.DS_Store')).toBeNull();
    expect(describeSkippedVideoFile('a.mp4.tmp')).toBeNull();
    expect(describeSkippedVideoFile('a.part')).toBeNull();
    // 大写标记 `.TMP.` 不算：isVideoFileName 的 `includes('.tmp.')` 是大小写敏感的，
    // 所以 `A.MP4.TMP.MP4` 会被当成正常视频收录（扩展名 .MP4 命中）。
    // 这里是「如实记录现状」，不是认可它 —— 要改就得同时改 isVideoFileName 的语义，
    // 那是另一件事（见交付报告的遗留项）。describeSkippedVideoFile 必须与它保持一致，
    // 否则同一个文件会既被收录又被记诊断。
    expect(describeSkippedVideoFile('A.MP4.TMP.MP4')).toBeNull();
    expect(isVideoFileName('A.MP4.TMP.MP4')).toBe(true);
    // 正常视频不该被这个函数判成「被排除」
    expect(describeSkippedVideoFile('正常.mp4')).toBeNull();
    expect(describeSkippedVideoFile('')).toBeNull();
  });

  it('空目录返回空列表且无诊断，rootAvailable=true', async () => {
    const root = await makeTempDir();
    const result = await scanVideoRoot(root);
    expect(result.videos).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.rootAvailable).toBe(true);
  });

  it('根目录不存在 → rootAvailable=false（与「目录存在但为空」区分开）', async () => {
    const root = await makeTempDir();
    await fsp.rm(root, { recursive: true, force: true });
    const result = await scanVideoRoot(root);
    expect(result.videos).toEqual([]);
    expect(result.rootAvailable).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].kind).toBe('unreadable');
  });

  it('零字节文件记 unreadable 诊断，不中断扫描', async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, '空的.mp4'), '');
    await writeFile(path.join(root, '好的.mp4'), 'ok');

    const result = await scanVideoRoot(root);
    expect(result.videos).toHaveLength(1);
    expect(result.diagnostics).toEqual([
      { path: '空的.mp4', kind: 'unreadable', message: expect.stringContaining('空') },
    ]);
  });

  it('符号链接指向根目录外 → 跳过并记 hidden', async () => {
    const root = await makeTempDir();
    const outside = await makeTempDir('p038-outside-');
    await writeFile(path.join(outside, '机密.mp4'), 'secret');
    await writeFile(path.join(root, '正常.mp4'), 'ok');
    await fsp.symlink(path.join(outside, '机密.mp4'), path.join(root, '逃逸.mp4'));

    const result = await scanVideoRoot(root);
    expect(result.videos.map((v) => v.relativePath)).toEqual(['正常.mp4']);
    expect(result.diagnostics).toEqual([
      { path: '逃逸.mp4', kind: 'hidden', message: expect.stringContaining('根目录之外') },
    ]);
  });

  it('符号链接目录指向根目录外 → 整个目录跳过', async () => {
    const root = await makeTempDir();
    const outside = await makeTempDir('p038-outside-');
    await writeFile(path.join(outside, 'sub', 'x.mp4'), 'x');
    await fsp.symlink(path.join(outside, 'sub'), path.join(root, '外链目录'));
    await writeFile(path.join(root, '正常.mp4'), 'ok');

    const result = await scanVideoRoot(root);
    expect(result.videos.map((v) => v.relativePath)).toEqual(['正常.mp4']);
    expect(result.diagnostics.some((d) => d.path === '外链目录' && d.kind === 'hidden')).toBe(true);
  });

  it('符号链接指向根目录内 → 正常收录', async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, '真实', 'x.mp4'), 'x');
    await fsp.symlink(path.join(root, '真实', 'x.mp4'), path.join(root, '内链.mp4'));

    const result = await scanVideoRoot(root);
    expect(result.videos.map((v) => v.relativePath).sort()).toEqual(['内链.mp4', '真实/x.mp4']);
  });

  it('指向自己的符号链接目录不会无限递归', async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, 'sub', 'x.mp4'), 'x');
    await fsp.symlink(path.join(root, 'sub'), path.join(root, 'sub', '自环'));

    const result = await scanVideoRoot(root);
    expect(result.videos).toHaveLength(1);
  });

  it('目录不存在时给出可读错误而不是空目录', async () => {
    const root = await makeTempDir();
    await fsp.rm(root, { recursive: true, force: true });
    const check = await checkVideoRoot(root);
    expect(check.ok).toBe(false);
    expect(check.error).toContain('VIDEO_ROOT');
  });

  it('相对路径排序稳定（码位序）', async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, 'b.mp4'), 'b');
    await writeFile(path.join(root, 'a.mp4'), 'a');
    const { videos } = await scanVideoRoot(root);
    expect(videos.map((v) => v.relativePath)).toEqual(['a.mp4', 'b.mp4']);
  });
});

/* ------------------------------------------------------------------ *
 * A2 标注合并
 * ------------------------------------------------------------------ */

describe('标注合并', () => {
  it('文件不存在时按空标注处理，服务仍可用', async () => {
    const result = await loadAnnotations(path.join(os.tmpdir(), 'p038-绝不存在的标注.json'));
    expect(result.present).toBe(false);
    expect(result.videos.size).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  it('level 只放行 K1–K5，其它值一律作废并记 metadata 诊断（绝不猜、绝不映射）', async () => {
    const root = await makeTempDir();
    const file = path.join(root, 'annotations.json');
    await fsp.writeFile(
      file,
      JSON.stringify({
        version: 1,
        videos: {
          'a.mp4': { level: 'K1' },
          'b.mp4': { level: 'K9' },
          'c.mp4': { level: 'k1' },
          'd.mp4': { level: '初级' },
          'e.mp4': { level: 3 },
          // 故意塞一个旧的 difficulty 字段：它已整体删除，绝不能被当成等级来源
          'f.mp4': { difficulty: 'advanced' } as unknown as Record<string, never>,
        },
      }),
      'utf8',
    );

    const result = await loadAnnotations(file);
    expect(result.videos.get('a.mp4')!.level).toBe('K1');
    for (const key of ['b.mp4', 'c.mp4', 'd.mp4', 'e.mp4']) {
      expect(result.videos.get(key)!.level, key).toBeUndefined();
    }
    // 关键红线：残留的 difficulty 字段既不进 entry，也绝不可能被推成任何 K 值
    const f = result.videos.get('f.mp4')!;
    expect(f.level).toBeUndefined();
    expect('difficulty' in f).toBe(false);

    const levelErrors = result.diagnostics.filter((d) => d.message.includes('不是合法等级'));
    expect(levelErrors).toHaveLength(4);
    for (const d of levelErrors) expect(d.kind).toBe('metadata');
  });

  it('非法 types 被拒并记 metadata 诊断，绝不当默认值', async () => {
    const root = await makeTempDir();
    const file = path.join(root, 'annotations.json');
    await fsp.writeFile(
      file,
      JSON.stringify({
        version: 1,
        videos: {
          'a.mp4': { types: ['stretch', '瑜伽', 42] },
          'b.mp4': { types: ['running'] },
        },
      }),
      'utf8',
    );

    const result = await loadAnnotations(file);
    const a = result.videos.get('a.mp4')!;
    expect(a.types).toEqual(['stretch']); // 非法项被剔除，不冒名顶替
    expect(result.diagnostics.every((d) => d.kind === 'metadata')).toBe(true);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(2);
    // 12 类里的新枚举要能正常放行，不能被当非法
    expect(result.videos.get('b.mp4')!.types).toEqual(['running']);
  });

  it('JSON 坏了也能继续，只记一条诊断', async () => {
    const root = await makeTempDir();
    const file = path.join(root, 'annotations.json');
    await fsp.writeFile(file, '{ 不是 json', 'utf8');
    const result = await loadAnnotations(file);
    expect(result.present).toBe(true);
    expect(result.videos.size).toBe(0);
    expect(result.diagnostics).toEqual([
      { path: expect.any(String), kind: 'metadata', message: expect.stringContaining('JSON') },
    ]);
  });

  it('标注键会做同样的规范化', async () => {
    const root = await makeTempDir();
    const file = path.join(root, 'annotations.json');
    await fsp.writeFile(file, JSON.stringify({ videos: { './a\\b.mp4': { types: ['core'] } } }), 'utf8');
    const result = await loadAnnotations(file);
    expect(result.videos.has('a/b.mp4')).toBe(true);
  });

  it('defaultTypes 逐级向上回退', () => {
    const defaults = new Map([['课程', ['core']], ['', ['fullbody']]]);
    expect(resolveDefaultTypes(defaults, '课程/初级/x.mp4')).toEqual(['core']);
    expect(resolveDefaultTypes(defaults, '其它/x.mp4')).toEqual(['fullbody']);
    expect(resolveDefaultTypes(new Map(), '课程/x.mp4')).toEqual([]);
  });

  /* ---------------------------------------------------------------- *
   * 转义匹配：部署目录里文件名被 prepare 转义成 `~ff0f~`，
   * 标注键却是源目录原名（含 `／`）。这组用例锁住两条路：
   *   F1 查得到（类型 + 难度都对）
   *   F2 就算查不到，标题也不能漏 `~ff0f~`
   * ---------------------------------------------------------------- */

  it('F1：含全角 ／ 的标注键能被转义态路径命中（类型 + 难度都对，不退回 unknown）', async () => {
    const root = await makeTempDir();
    const file = path.join(root, 'annotations.json');
    // 真实缺陷的现场：键是源目录原名，部署目录里的文件名是 ~ff0f~ 形态
    await fsp.writeFile(
      file,
      JSON.stringify({
        version: 1,
        videos: {
          'keep/01 5 分钟睡前全面万能拉伸／一扫疲惫·床上练.mp4': {
            title: '5 分钟睡前全面万能拉伸／一扫疲惫·床上练',
            types: ['stretch'],
            level: 'K1',
          },
        },
        defaultTypes: { keep: ['fullbody'] },
      }),
      'utf8',
    );

    const bundle = await loadAnnotations(file);
    const deployed = 'keep/01 5 分钟睡前全面万能拉伸~ff0f~一扫疲惫·床上练.mp4';
    // 部署目录里真实存在的名字（用脚本的权威规则算出来，而不是手写）
    expect(escapeRelativePath('keep/01 5 分钟睡前全面万能拉伸／一扫疲惫·床上练.mp4')).toBe(deployed);

    const hit = find(bundle, deployed);
    expect(hit).not.toBeNull();
    expect(hit!.level).toBe('K1');
    expect(hit!.types).toEqual(['stretch']);
    expect(hit!.title).toBe('5 分钟睡前全面万能拉伸／一扫疲惫·床上练');
    // 原始形态当然也要能查到（VIDEO_ROOT 指源目录时走这条）
    expect(find(bundle, 'keep/01 5 分钟睡前全面万能拉伸／一扫疲惫·床上练.mp4')).toEqual(hit);
    // 含 `／` 的标注不该凭空造出 metadata 诊断（撞键才记）
    expect(bundle.diagnostics).toEqual([]);
  });

  it('F1：两个不同源文件转义后撞成同一个键 → 记 metadata 诊断，不静默覆盖', async () => {
    const root = await makeTempDir();
    const file = path.join(root, 'annotations.json');
    // 撞键不是臆想出来的边角：prepare 把所有源统一转成 `.mp4`，所以同目录里
    // `01 视频.mp4` 与 `01 视频.mov` 转义后必然是同一个 `01 视频.mp4`
    // （`targetRelativePath` 固定接回 `.mp4`）。脚本侧用 `uniqueTarget` 追加 `~d1~`
    // 消歧，服务端索引不了那个后缀，所以必须记诊断而不是悄悄丢掉一条。
    await fsp.writeFile(
      file,
      JSON.stringify({
        version: 1,
        videos: {
          'd/01 视频.mp4': { types: ['core'], level: 'K1' },
          'd/01 视频.mov': { types: ['cardio'], level: 'K5' },
        },
      }),
      'utf8',
    );

    const bundle = await loadAnnotations(file);
    expect(escapeRelativePath('d/01 视频.mp4')).toBe(escapeRelativePath('d/01 视频.mov'));

    const collided = bundle.diagnostics.filter((d) => d.kind === 'metadata');
    expect(collided).toHaveLength(1);
    expect(collided[0].path).toBe('d/01 视频.mp4');
    expect(collided[0].message).toContain('转义后是同一个路径');
    expect(collided[0].message).toContain('d/01 视频.mp4');
    expect(collided[0].message).toContain('d/01 视频.mov');
    // 诊断里绝不能出现绝对路径（diagnostics 原样发给浏览器）
    expect(collided[0].message).not.toContain(root);
    // 两条原始标注都还在原始索引里（没丢数据），部署态键上只挂得下其中一条
    expect(bundle.videos.size).toBe(2);
    expect(bundle.videosByTarget.get('d/01 视频.mp4')!.entry.level).toBe('K5');
    // 未撞键的普通路径不该多出诊断
    const clean = await (async () => {
      const dir = await makeTempDir();
      const cleanFile = path.join(dir, 'annotations.json');
      await fsp.writeFile(cleanFile, JSON.stringify({ videos: { 'x/y.mp4': { types: ['core'] } } }), 'utf8');
      return loadAnnotations(cleanFile);
    })();
    expect(clean.diagnostics).toEqual([]);
  });

  it('回归：不含 ／ 的普通路径完全不受转义匹配影响（原始键优先、查得到、查不到也不乱猜）', async () => {
    const root = await makeTempDir();
    const file = path.join(root, 'annotations.json');
    await fsp.writeFile(
      file,
      JSON.stringify({
        version: 1,
        videos: {
          'keep】晨起唤醒/01 20 分钟晨起唤醒·清晨瑜伽.mp4': { title: '晨起瑜伽', types: ['stretch'], level: 'K1' },
          'keep】核心/03 核心激活 90 秒.mp4': { types: ['core'] },
        },
        defaultTypes: { 'keep】核心': ['core'] },
      }),
      'utf8',
    );

    const bundle = await loadAnnotations(file);
    expect(bundle.diagnostics).toEqual([]);
    // 无需转义的名字，转义态与原始态是同一个字符串，两种查法都命中同一条
    for (const rel of ['keep】晨起唤醒/01 20 分钟晨起唤醒·清晨瑜伽.mp4', 'keep】核心/03 核心激活 90 秒.mp4']) {
      expect(escapeRelativePath(rel), rel).toBe(rel);
      expect(find(bundle, rel), rel).toBe(bundle.videos.get(rel));
    }
    expect(find(bundle, 'keep】晨起唤醒/01 20 分钟晨起唤醒·清晨瑜伽.mp4')!.level).toBe('K1');
    // 真的没有标注的视频：返回 null，绝不张冠李戴拿邻近那条
    expect(find(bundle, 'keep】核心/99 根本没有这条.mp4')).toBeNull();
    // defaultTypes 的老行为没变
    expect(resolveDefaultTypes(bundle.defaultTypes, 'keep】核心/99 根本没有这条.mp4')).toEqual(['core']);
    expect(resolveDefaultTypes(bundle.defaultTypes, 'keep】核心/99 根本没有这条.mp4', bundle.defaultTypesByTarget)).toEqual(['core']);
  });

  it('F1：目录名含 ／ 时 defaultTypes 兜底在部署态也能命中（实测真实数据里没有，规则仍通用）', async () => {
    const root = await makeTempDir();
    const file = path.join(root, 'annotations.json');
    // 实测 catalog/annotations.json 的 23 个 defaultTypes 目录键都不含 `／`
    // （`／` 全在文件名里），所以这条是「规则通用性」的保险，不是已知线上数据。
    await fsp.writeFile(
      file,
      JSON.stringify({ version: 1, videos: {}, defaultTypes: { 'keep／睡前': ['stretch'] } }),
      'utf8',
    );
    const bundle = await loadAnnotations(file);
    expect(bundle.defaultTypes.has('keep／睡前')).toBe(true);
    // 部署态目录名：靠转义索引命中
    expect(resolveDefaultTypes(bundle.defaultTypes, 'keep~ff0f~睡前/01 x.mp4', bundle.defaultTypesByTarget)).toEqual(['stretch']);
    // 源目录形态：靠原始索引命中（省略第三参 = 旧行为）
    expect(resolveDefaultTypes(bundle.defaultTypes, 'keep／睡前/01 x.mp4')).toEqual(['stretch']);
    // 逐级向上回退在部署态下依然成立（子目录 → 父目录 → 根）
    expect(resolveDefaultTypes(bundle.defaultTypes, 'keep~ff0f~睡前/初级/01 x.mp4', bundle.defaultTypesByTarget)).toEqual(['stretch']);
    // 无关目录不串味
    expect(resolveDefaultTypes(bundle.defaultTypes, '别的/01 x.mp4', bundle.defaultTypesByTarget)).toEqual([]);
  });

  it('F2：titleFromRelativePath 还原转义（~ff0f~ → ／），且对同一路径幂等', () => {
    // 标注缺失时的兜底标题：不能把机器噪音显示给用户
    expect(titleFromRelativePath('keep/01 5 分钟睡前全面万能拉伸~ff0f~一扫疲惫·床上练.mp4')).toBe(
      '5 分钟睡前全面万能拉伸／一扫疲惫·床上练',
    );
    // 原始态本来就是同一个标题（还原是等价的，不是「凑巧像」）
    expect(titleFromRelativePath('keep/01 5 分钟睡前全面万能拉伸／一扫疲惫·床上练.mp4')).toBe(
      '5 分钟睡前全面万能拉伸／一扫疲惫·床上练',
    );
    // 幂等：同一个入参反复调用结果恒等（还原只作用于入参，不回写输出）
    const deployed = 'keep/01 5 分钟睡前全面万能拉伸~ff0f~一扫疲惫·床上练.mp4';
    const once = titleFromRelativePath(deployed);
    expect(titleFromRelativePath(deployed)).toBe(once);
    expect(titleFromRelativePath(deployed)).toBe(once);
    // 没有转义残留的普通标题原样返回，一个字都不动
    expect(titleFromRelativePath('keep/01 20 分钟晨起唤醒·清晨瑜伽.mp4')).toBe('20 分钟晨起唤醒·清晨瑜伽');
    expect(titleFromRelativePath('keep/01.mp4')).toBe('keep');
    // 目录名里的转义同样还原（文件名剥光后要退回目录名时也不漏噪音）
    expect(titleFromRelativePath('a~ff0f~b/01.mp4')).toBe('a／b');
    // 其它转义字符也一并还原（不只是 ／）
    expect(titleFromRelativePath('d/01 a~007e~b~003c~.mp4')).toBe('a~b<');
  });

  it('标题：只削真正的序号，不动以数字开头的真标题', () => {
    expect(titleFromRelativePath('keep/01 20 分钟晨起唤醒.mp4')).toBe('20 分钟晨起唤醒');
    expect(titleFromRelativePath('keep/1. 热身.mp4')).toBe('热身');
    expect(titleFromRelativePath('keep/02_拉伸.mp4')).toBe('拉伸');
    // 真标题本身就以数字开头，不能被削
    expect(titleFromRelativePath('keep/20 分钟晨起唤醒·清晨瑜伽.mp4')).toBe('20 分钟晨起唤醒·清晨瑜伽');
    expect(titleFromRelativePath('keep/10 分钟腹肌撕裂.mp4')).toBe('10 分钟腹肌撕裂');
    // 没有序号可用时退回目录名
    expect(titleFromRelativePath('keep/01.mp4')).toBe('keep');
    expect(titleFromRelativePath('根目录下的视频.mp4')).toBe('根目录下的视频');
  });

  it('splitExtension 只认最后一个点', () => {
    expect(splitExtension('a.mp4.tmp.mp4')).toEqual({ stem: 'a.mp4.tmp', ext: '.mp4' });
    expect(splitExtension('a.mp4')).toEqual({ stem: 'a', ext: '.mp4' });
    expect(splitExtension('a.mp4.tmp')).toEqual({ stem: 'a.mp4', ext: '.tmp' });
    expect(splitExtension('.hidden')).toEqual({ stem: '.hidden', ext: '' });
  });
});

/* ------------------------------------------------------------------ *
 * A4 Range 解析（纯函数层）
 * ------------------------------------------------------------------ */

describe('Range 解析', () => {
  it('无 Range 头 → 整段', () => {
    expect(parseRange(undefined, SIZE)).toEqual({ type: 'full' });
    expect(parseRange('', SIZE)).toEqual({ type: 'full' });
    expect(buildRangeResponse({ type: 'full' }, SIZE, 'video/mp4').status).toBe(200);
    expect(buildRangeResponse({ type: 'full' }, SIZE, 'video/mp4').headers['Content-Length']).toBe('1000');
  });

  it('各种合法范围', () => {
    expect(parseRange('bytes=0-', SIZE)).toEqual({ type: 'range', start: 0, end: 999 });
    expect(parseRange('bytes=0-99', SIZE)).toEqual({ type: 'range', start: 0, end: 99 });
    expect(parseRange('bytes=100-199', SIZE)).toEqual({ type: 'range', start: 100, end: 199 });
    expect(parseRange('bytes=100-', SIZE)).toEqual({ type: 'range', start: 100, end: 999 });
    expect(parseRange('bytes=-500', SIZE)).toEqual({ type: 'range', start: 500, end: 999 });
    expect(parseRange('bytes=-5000', SIZE)).toEqual({ type: 'range', start: 0, end: 999 });
    // 末端越界要夹到 size-1，而不是判非法
    expect(parseRange('bytes=900-99999', SIZE)).toEqual({ type: 'range', start: 900, end: 999 });
  });

  it('206 响应头正确', () => {
    const { status, headers } = buildRangeResponse(parseRange('bytes=100-199', SIZE), SIZE, 'video/mp4');
    expect(status).toBe(206);
    expect(headers['Content-Range']).toBe('bytes 100-199/1000');
    expect(headers['Content-Length']).toBe('100');
    expect(headers['Accept-Ranges']).toBe('bytes');
  });

  it('多范围降级成 200 整段（不做 multipart）', () => {
    expect(parseRange('bytes=0-99,200-299', SIZE)).toEqual({ type: 'multi' });
    expect(buildRangeResponse({ type: 'multi' }, SIZE, 'video/mp4').status).toBe(200);
  });

  it('非法 / 越界范围 → 416', () => {
    for (const header of ['bytes=99999999999-', 'abc', 'bytes=-', 'bytes=5-2', 'bytes=-0', 'items=0-10', 'bytes=abc-def']) {
      expect(parseRange(header, SIZE), header).toEqual({ type: 'unsatisfiable' });
    }
    expect(buildRangeResponse({ type: 'unsatisfiable' }, SIZE, 'video/mp4').headers['Content-Range']).toBe('bytes */1000');
  });

  it('媒体类型按扩展名', () => {
    expect(contentTypeFor('a.mp4')).toBe('video/mp4');
    expect(contentTypeFor('a.MP4')).toBe('video/mp4');
    expect(contentTypeFor('a.mov')).toBe('video/quicktime');
    expect(contentTypeFor('a.m4v')).toBe('video/x-m4v');
    expect(contentTypeFor('a.txt')).toBe('application/octet-stream');
  });
});

/* ------------------------------------------------------------------ *
 * HTTP 接口（真起一个临时服务）
 * ------------------------------------------------------------------ */

describe('HTTP 接口', () => {
  let server: Server;
  let base: string;
  let videoRoot: string;
  let catalogDir: string;
  let annotationsFile: string;
  let thumbnailDir: string;
  let targetId: string;

  beforeAll(async () => {
    videoRoot = await makeTempDir('p038-videos-');
    catalogDir = await makeTempDir('p038-catalog-');
    thumbnailDir = path.join(catalogDir, 'thumbnails');
    annotationsFile = path.join(catalogDir, 'annotations.json');

    await writeFile(path.join(videoRoot, 'keep】晨起唤醒', '01 20 分钟晨起唤醒·清晨瑜伽.mp4'), VIDEO_BYTES);
    await writeFile(path.join(videoRoot, 'keep】晨起唤醒', '04 20 分钟晨起唤醒.mp4.tmp.mp4'), 'junk');
    await writeFile(path.join(videoRoot, 'keep】核心', '03 核心激活 90 秒.mp4'), VIDEO_BYTES);

    await writeFile(path.join(thumbnailDir, 'keep】晨起唤醒', '01 20 分钟晨起唤醒·清晨瑜伽.jpg'), 'JPEGDATA');

    await fsp.writeFile(
      annotationsFile,
      JSON.stringify({
        version: 1,
        videos: {
          'keep】晨起唤醒/01 20 分钟晨起唤醒·清晨瑜伽.mp4': {
            title: '标注里的标题',
            types: ['stretch'],
            level: 'K1',
          },
          'keep】晨起唤醒/04 坏文件.mp4': { types: ['瞎写的'], level: 'K9' },
        },
        defaultTypes: { 'keep】核心': ['core'] },
      }),
      'utf8',
    );
    await fsp.writeFile(
      path.join(catalogDir, 'catalog-cache.json'),
      JSON.stringify({ 'keep】晨起唤醒/01 20 分钟晨起唤醒·清晨瑜伽.mp4': { durationSeconds: 125.5 } }),
      'utf8',
    );

    server = createServer({
      env: {
        VIDEO_ROOT: videoRoot,
        ANNOTATIONS_FILE: annotationsFile,
        THUMBNAIL_DIR: thumbnailDir,
        // 故意指向不存在的目录，用来验证「前端未构建」提示页
        DIST_DIR: path.join(catalogDir, 'no-such-dist'),
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${portOf(server)}`;

    const catalog = await getJson(`${base}/api/videos`);
    targetId = catalog.videos.find((v) => v.relativePath.startsWith('keep】晨起唤醒/01'))!.id;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /api/health 返回契约字段', async () => {
    const response = await fetch(`${base}/api/health`);
    const body = (await response.json()) as ApiPayload;
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.videoCount).toBe(2);
    expect(body.annotationCount).toBe(2);
    expect(body.videoRootAvailable).toBe(true);
    expect(typeof body.diagnosticCount).toBe('number');
    expect(typeof body.generatedAt).toBe('string');
    expect(new Date(body.generatedAt).toString()).not.toBe('Invalid Date');
    // 一切正常时不该带 error 字段
    expect(body.error).toBeUndefined();
  });

  it('/api/health 能区分「目录不存在」和「目录存在但没有视频」，两者都不是 ok:true', async () => {
    const missing = await makeTempDir('p038-missing-root-');
    await fsp.rm(missing, { recursive: true, force: true });
    const empty = await makeTempDir('p038-empty-root-');

    const start = async (videoRoot: string) => {
      const s = createServer({
        env: {
          VIDEO_ROOT: videoRoot,
          ANNOTATIONS_FILE: path.join(videoRoot, 'a.json'),
          THUMBNAIL_DIR: path.join(videoRoot, 'thumbs'),
          DIST_DIR: path.join(videoRoot, 'dist'),
        },
      });
      await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', () => resolve()));
      return s;
    };

    const missingServer = await start(missing);
    const emptyServer = await start(empty);
    try {
      const missingHealth = (await (
        await fetch(`http://127.0.0.1:${portOf(missingServer)}/api/health`)
      ).json()) as ApiPayload;
      const emptyHealth = (await (
        await fetch(`http://127.0.0.1:${portOf(emptyServer)}/api/health`)
      ).json()) as ApiPayload;

      // HTTP 状态码仍然是 200：compose healthcheck 只看状态码，服务本身是活着的。
      expect(missingHealth.videoCount).toBe(0);
      expect(emptyHealth.videoCount).toBe(0);

      // 关键回归：目录没了 / 一个视频都没有，都不许报 ok:true
      // （否则容器一直 healthy，用户只看到一片空白，还查不出原因）
      expect(missingHealth.ok).toBe(false);
      expect(emptyHealth.ok).toBe(false);

      // 两种故障必须能被区分开
      expect(missingHealth.videoRootAvailable).toBe(false);
      expect(emptyHealth.videoRootAvailable).toBe(true);
      expect(missingHealth.error).toMatch(/根目录/);
      expect(emptyHealth.error).toMatch(/一个视频文件都没有/);
      expect(missingHealth.error).not.toBe(emptyHealth.error);
    } finally {
      await new Promise<void>((resolve) => missingServer.close(() => resolve()));
      await new Promise<void>((resolve) => emptyServer.close(() => resolve()));
    }
  });

  it('GET /api/videos 结构与 Video 形状一致', async () => {
    const response = await fetch(`${base}/api/videos`);
    const body = (await response.json()) as ApiPayload;
    expect(Object.keys(body).sort()).toEqual(['diagnostics', 'generatedAt', 'videos']);

    expect(body.videos).toHaveLength(2);
    for (const video of body.videos) {
      expect(Object.keys(video).sort()).toEqual([
        'available',
        'durationSeconds',
        'hasThumbnail',
        'id',
        'level',
        'playbackUrl',
        'relativePath',
        'thumbnailUrl',
        'title',
        'types',
      ]);
      expect(video.id).toMatch(/^[0-9a-f]{16}$/);
      expect(video.id).toBe(makeVideoId(video.relativePath));
      expect(video.relativePath.startsWith('/')).toBe(false);
      expect(video.playbackUrl).toBe(`/api/videos/${video.id}/stream`);
      expect([null, 'K1', 'K2', 'K3', 'K4', 'K5']).toContain(video.level);
      expect(Array.isArray(video.types)).toBe(true);
      expect(typeof video.hasThumbnail).toBe('boolean');
      expect(typeof video.available).toBe('boolean');
      // 绝不能泄露绝对路径
      expect(JSON.stringify(body)).not.toContain(videoRoot);
    }

    for (const diagnostic of body.diagnostics) {
      expect(Object.keys(diagnostic).sort()).toEqual(['kind', 'message', 'path']);
      expect(['unreadable', 'missing', 'duplicate', 'metadata', 'hidden']).toContain(diagnostic.kind);
    }
  });

  it('level 从标注一路透传到 /api/videos；未识图的那条是 null，绝不猜一个 K1', async () => {
    const body = await getJson(`${base}/api/videos`);

    // 标注里写了合法 level → 原样透传
    const annotated = body.videos.find((v) => v.relativePath === 'keep】晨起唤醒/01 20 分钟晨起唤醒·清晨瑜伽.mp4')!;
    expect(annotated.level).toBe('K1');

    // level 字段必须**永远存在**（哪怕值是 null），前端才知道「还没识别出来」
    for (const v of body.videos) expect(Object.hasOwn(v, 'level')).toBe(true);

    // 完全没有单条标注、只靠 defaultTypes 兜底的那条 → level 为 null，不是猜出来的 K1
    const fallback = body.videos.find((v) => v.relativePath === 'keep】核心/03 核心激活 90 秒.mp4')!;
    expect(fallback.level).toBeNull();
  });

  it('非法 level（K9）被丢弃并记诊断，标注里其余字段照常（不因一个错字毁掉整条标注）', async () => {
    const body = await getJson(`${base}/api/videos`);
    // 承载 K9 的那条文件名本身是坏文件名、已被扫描器排除，所以它只体现在诊断里
    expect(body.diagnostics.some((d) => d.message.includes('不是合法等级'))).toBe(true);
    // 合法那条的标注完全没受影响
    const annotated = body.videos.find((v) => v.relativePath === 'keep】晨起唤醒/01 20 分钟晨起唤醒·清晨瑜伽.mp4')!;
    expect(annotated.types).toEqual(['stretch']);
    expect(annotated.level).toBe('K1');
  });

  it('坏 .tmp.mp4 不进 /api/videos，但会作为 unreadable 诊断出现（FR-001）', async () => {
    const body = await getJson(`${base}/api/videos`);
    expect(body.videos.some((v) => v.relativePath.includes('.tmp.'))).toBe(false);
    expect(body.diagnostics).toContainEqual({
      path: 'keep】晨起唤醒/04 20 分钟晨起唤醒.mp4.tmp.mp4',
      kind: 'unreadable',
      message: '文件名含 .tmp.，疑似未写完的转存产物（下载或拷贝中途断开），已跳过',
    });
  });

  it('标注合并结果符合契约', async () => {
    const body = await getJson(`${base}/api/videos`);
    const annotated = body.videos.find((v) => v.id === targetId)!;
    expect(annotated.title).toBe('标注里的标题');
    expect(annotated.types).toEqual(['stretch']);
    expect(annotated.level).toBe('K1');
    expect(annotated.durationSeconds).toBe(125.5);
    expect(annotated.available).toBe(true);
    expect(annotated.hasThumbnail).toBe(true);
    // 缩略图 URL 带 ?v=<8 位十六进制>：封面被重写（size/mtime 变）时 URL 随之改变，
    // 老用户刷新就能穿透 24 小时的 Cache-Control 立刻拿到新封面（治白屏的关键）。
    // 路径部分必须逐字不变 —— 路由只认它，查询串对路由透明。
    expect(annotated.thumbnailUrl).toMatch(
      new RegExp(`^/api/videos/${targetId}/thumbnail\\?v=[0-9a-f]{8}$`),
    );

    // 没有任何标注 → level 诚实为 null，defaultTypes 兜底只补 types
    const core = body.videos.find((v) => v.relativePath.startsWith('keep】核心'))!;
    expect(core.level).toBeNull();
    expect(core.types).toEqual(['core']);
    expect(core.title).toBe('核心激活 90 秒'); // 文件名去掉 03 序号
    // 缓存里没时长 → 标成不可播放 + 记诊断
    expect(core.durationSeconds).toBe(0);
    expect(core.available).toBe(false);
    expect(body.diagnostics.some((d) => d.path === core.relativePath && d.kind === 'metadata')).toBe(true);
  });

  it('POST /api/rescan 返回同样的结构', async () => {
    const response = await fetch(`${base}/api/rescan`, { method: 'POST' });
    const body = (await response.json()) as ApiPayload;
    expect(response.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['diagnostics', 'generatedAt', 'videos']);
    expect(body.videos).toHaveLength(2);
  });

  it('GET 走查 GET /api/videos 的 405', async () => {
    expect((await fetch(`${base}/api/rescan`, { method: 'GET' })).status).toBe(405);
  });

  it('缩略图：有就返回，没有就 404', async () => {
    const ok = await fetch(`${base}/api/videos/${targetId}/thumbnail`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/jpeg');
    expect(await ok.text()).toBe('JPEGDATA');

    const body = await getJson(`${base}/api/videos`);
    const noThumb = body.videos.find((v) => !v.hasThumbnail)!;
    const missing = await fetch(`${base}/api/videos/${noThumb.id}/thumbnail`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as ApiPayload).error).toBe('thumbnail_not_found');
  });

  it('流：无 Range → 200 整段', async () => {
    const response = await fetch(`${base}/api/videos/${targetId}/stream`);
    expect(response.status).toBe(200);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe('1000');
    expect(response.headers.get('content-type')).toBe('video/mp4');
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(VIDEO_BYTES)).toBe(true);
  });

  it('流：bytes=0- → 206', async () => {
    const response = await fetch(`${base}/api/videos/${targetId}/stream`, { headers: { Range: 'bytes=0-' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-999/1000');
    expect(response.headers.get('content-length')).toBe('1000');
    expect(Buffer.from(await response.arrayBuffer()).equals(VIDEO_BYTES)).toBe(true);
  });

  it('流：bytes=100-199 → 206 且字节正确', async () => {
    const response = await fetch(`${base}/api/videos/${targetId}/stream`, {
      headers: { Range: 'bytes=100-199' },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 100-199/1000');
    expect(response.headers.get('content-length')).toBe('100');
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(VIDEO_BYTES.subarray(100, 200))).toBe(true);
  });

  it('流：开放式 bytes=100- 与后缀式 bytes=-500', async () => {
    const open = await fetch(`${base}/api/videos/${targetId}/stream`, { headers: { Range: 'bytes=100-' } });
    expect(open.status).toBe(206);
    expect(open.headers.get('content-range')).toBe('bytes 100-999/1000');
    expect(open.headers.get('content-length')).toBe('900');

    const suffix = await fetch(`${base}/api/videos/${targetId}/stream`, { headers: { Range: 'bytes=-500' } });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get('content-range')).toBe('bytes 500-999/1000');
    expect(Buffer.from(await suffix.arrayBuffer()).equals(VIDEO_BYTES.subarray(500))).toBe(true);
  });

  it('流：多范围 → 200 整段', async () => {
    const response = await fetch(`${base}/api/videos/${targetId}/stream`, {
      headers: { Range: 'bytes=0-99,200-299' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('1000');
    expect(Buffer.from(await response.arrayBuffer()).equals(VIDEO_BYTES)).toBe(true);
  });

  it('流：非法范围 → 416 + Content-Range: bytes */size', async () => {
    for (const header of ['bytes=99999999999-', 'abc', 'bytes=5-2', 'bytes=-']) {
      const response = await fetch(`${base}/api/videos/${targetId}/stream`, { headers: { Range: header } });
      expect(response.status, header).toBe(416);
      expect(response.headers.get('content-range'), header).toBe('bytes */1000');
      expect(((await response.json()) as ApiPayload).error, header).toBe('range_not_satisfiable');
    }
  });

  it('HEAD 的头与对应 GET 一致，且没有 body', async () => {
    const head = await fetch(`${base}/api/videos/${targetId}/stream`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('1000');
    expect(head.headers.get('content-type')).toBe('video/mp4');
    expect(head.headers.get('accept-ranges')).toBe('bytes');
    expect((await head.arrayBuffer()).byteLength).toBe(0);

    const ranged = await fetch(`${base}/api/videos/${targetId}/stream`, {
      method: 'HEAD',
      headers: { Range: 'bytes=100-199' },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe('bytes 100-199/1000');
    expect((await ranged.arrayBuffer()).byteLength).toBe(0);
  });

  it('未知 id → 404 JSON', async () => {
    const response = await fetch(`${base}/api/videos/0123456789abcdef/stream`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(((await response.json()) as ApiPayload).error).toBe('video_not_found');
  });

  it('越界 id 一律 404，绝不读到根目录外的文件', async () => {
    const attacks = [
      '..%2F..%2F..%2Fetc%2Fpasswd',
      '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '..',
      '%2Fetc%2Fpasswd',
      '0123456789abcdef/../../etc/passwd',
      '0123456789ABCDEF',
      '%ff%fe',
      '0000000000000000',
    ];
    for (const raw of attacks) {
      const response = await fetch(`${base}/api/videos/${raw}/stream`, { redirect: 'manual' });
      expect([400, 404], raw).toContain(response.status);
      const text = await response.text();
      expect(text, raw).not.toContain('root:');
    }
  });

  it('文件在流开始前被删掉 → 404 + missing 诊断，服务不崩', async () => {
    const dir = await makeTempDir('p038-ephemeral-');
    const server2 = createServer({
      env: {
        VIDEO_ROOT: dir,
        ANNOTATIONS_FILE: path.join(dir, 'a.json'),
        THUMBNAIL_DIR: path.join(dir, 'thumbs'),
        DIST_DIR: path.join(dir, 'dist'),
      },
    });
    await new Promise<void>((resolve) => server2.listen(0, '127.0.0.1', () => resolve()));
    const base2 = `http://127.0.0.1:${portOf(server2)}`;
    try {
      await writeFile(path.join(dir, 'x.mp4'), VIDEO_BYTES);
      const first = await getJson(`${base2}/api/videos`);
      const id = first.videos[0].id;
      await fsp.rm(path.join(dir, 'x.mp4'));

      const gone = await fetch(`${base2}/api/videos/${id}/stream`);
      expect(gone.status).toBe(404);
      expect(((await gone.json()) as ApiPayload).error).toBe('video_not_found');

      const after = await getJson(`${base2}/api/rescan`, { method: 'POST' });
      expect(after.videos).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve) => server2.close(() => resolve()));
    }
  });

  it('客户端中途断开不会让服务崩溃，后续请求照常', async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise<void>((resolve) => {
        const req = http.request(
          `${base}/api/videos/${targetId}/stream`,
          { headers: { Range: 'bytes=0-999' } },
          (res) => {
            res.once('data', () => {
              res.destroy();
              req.destroy();
              resolve();
            });
          },
        );
        req.on('error', () => resolve());
        req.end();
      });
    }
    // 关键断言：进程还活着，还能正常应答
    const after = await fetch(`${base}/api/health`);
    expect(after.status).toBe(200);
    expect(((await after.json()) as ApiPayload).ok).toBe(true);
  });

  it('未知接口与静态资源回退', async () => {
    const unknown = await fetch(`${base}/api/nope`);
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as ApiPayload).error).toBe('not_found');
  });

  it('dist 不存在时 / 返回「前端未构建」提示页，且不影响 /api', async () => {
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain('前端未构建');
    expect(html).toContain('pnpm build');

    expect((await fetch(`${base}/api/videos`)).status).toBe(200);
  });

  it('dist 存在时提供 index.html、SPA 回退，且不拦截 /api', async () => {
    const dist = await makeTempDir('p038-dist-');
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
    await writeFile(path.join(dist, 'assets', 'app-abc.js'), 'console.log(1)');
    await writeFile(path.join(dist, '.env'), 'SECRET=1');

    const server3 = createServer({
      env: {
        VIDEO_ROOT: videoRoot,
        ANNOTATIONS_FILE: annotationsFile,
        THUMBNAIL_DIR: thumbnailDir,
        DIST_DIR: dist,
      },
    });
    await new Promise<void>((resolve) => server3.listen(0, '127.0.0.1', () => resolve()));
    const base3 = `http://127.0.0.1:${portOf(server3)}`;
    try {
      const index = await fetch(`${base3}/`);
      expect(index.status).toBe(200);
      expect(await index.text()).toContain('id="root"');

      const asset = await fetch(`${base3}/assets/app-abc.js`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toContain('text/javascript');

      // SPA 路由：不带扩展名的路径回退到 index.html
      const spa = await fetch(`${base3}/watch/abc123`);
      expect(spa.status).toBe(200);
      expect(await spa.text()).toContain('id="root"');

      // /api 绝不能被静态回退吃掉
      const api = await fetch(`${base3}/api/videos`);
      expect(api.headers.get('content-type')).toContain('application/json');
      expect(((await api.json()) as ApiPayload).videos).toHaveLength(2);

      const missingApi = await fetch(`${base3}/api/does-not-exist`);
      expect(missingApi.status).toBe(404);
      expect(missingApi.headers.get('content-type')).toContain('application/json');

      // 缺失的资源不该被回退成 HTML
      expect((await fetch(`${base3}/assets/nope.js`)).status).toBe(404);

      // 隐藏文件与路径穿越都不给
      expect((await fetch(`${base3}/.env`)).status).toBe(404);
      const traversal = await fetch(`${base3}/..%2f..%2f..%2fetc%2fpasswd`, { redirect: 'manual' });
      expect([400, 404]).toContain(traversal.status);
      expect(await traversal.text()).not.toContain('root:');
    } finally {
      await new Promise<void>((resolve) => server3.close(() => resolve()));
    }
  });

  it('未捕获异常不会带走进程', async () => {
    // 故意打一个会触发 404 分支的畸形请求，确认服务随后仍能应答
    await fetch(`${base}/api/videos/%/stream`).catch(() => {});
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ *
 * B5 时长缓存：宿主机预生成 → 服务端零缺项
 *
 * 背景（2026-09-28 线上事故，本组测试就是它的回归守卫）：
 *   部署形态下容器镜像**刻意不装 ffmpeg**（`docker exec … which ffprobe` → 无），
 *   而 `catalog` 又是 `:ro` 只读挂载（容器还 `read_only: true`），
 *   于是 `server/duration-probe.mjs` 的后台补缓存两条路都走不通。
 *   结果：130 个视频全部 `available:false`、`durationSeconds:0`，
 *   网页整站不可用，而容器 healthy、HTTP 200、`videoCount=130` —— 全都「看起来正常」。
 *   本地 8899 验收没暴露，是因为开发目录可写、且开发机上装了 ffprobe。
 *
 *   解法是「在宿主机侧预生成 catalog-cache.json，随部署挂进 APP_CATALOG_DIR」。
 *   这类修复最大的风险是「键对不上」：文件生成了、服务端却一条都查不到，
 *   于是症状和没修复一模一样。所以下面最重要的不是「跑通了」，
 *   而是**逐条比对缓存键与服务端扫描出的 relativePath**。
 * ------------------------------------------------------------------ */

describe('B5 时长缓存：cache 子命令产出的键必须与扫描出的 relativePath 逐字一致', () => {
  /**
   * 造一棵**部署态**的播放文件树：文件名就是 prepare 转义后的结果。
   * 刻意包含 `~ff0f~` 这类转义名 —— 2026-09-28 的旧缓存里混着
   * 12 条按**源目录原名**（含全角 `／`）写的键，服务端一条都查不到。
   */
  const DEPLOYED_FILES = [
    'Keep_20/01 4 分钟 Tabata 燃脂急救·更暴汗！.mp4',
    'keep/01 5 分钟睡前全面万能拉伸~ff0f~一扫疲惫·床上练.mp4',
    'keep/02 5 分钟睡前舒缓放松~ff0f~练完秒睡·床上练~ff0f~久坐族.mp4',
    'keep】晨起唤醒/01 20 分钟晨起唤醒·清晨瑜伽.mp4',
    '带 空格 的 目录/hello world.mp4',
  ];

  const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
  const CACHE_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/prepare-videos.mjs');

  let haveFfmpeg = true;
  let videoRoot = '';
  let catalogDir = '';
  let cacheFile = '';
  let cacheKeys: string[] = [];
  let server: Server | null = null;
  let base = '';

  beforeAll(async () => {
    try {
      await execFileAsync(FFMPEG, ['-version']);
    } catch {
      haveFfmpeg = false;
      return;
    }

    videoRoot = await makeTempDir('p038-cache-videos-');
    catalogDir = await makeTempDir('p038-cache-catalog-');
    cacheFile = path.join(catalogDir, 'catalog-cache.json');

    // 真实素材：ffprobe 必须真的能解析出时长，mock 掉就等于没测这条链路。
    const sample = path.join(videoRoot, '.sample.mp4');
    await execFileAsync(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=3:r=10',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', '-t', '3', sample,
    ]);
    const bytes = await fsp.readFile(sample);
    for (const rel of DEPLOYED_FILES) {
      const target = path.join(videoRoot, rel);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, bytes);
    }
    await fsp.rm(sample, { force: true });

    // cache 子命令要求 --out 指向真正的标注目录（服务端从标注文件推缓存路径）
    await fsp.writeFile(path.join(catalogDir, 'annotations.json'), JSON.stringify({ version: 1, videos: {} }), 'utf8');

    // 先故意放一份「按源目录原名写的旧缓存」，验证它会被清掉而不是被当成命中
    await fsp.writeFile(
      cacheFile,
      JSON.stringify({ 'keep/01 5 分钟睡前全面万能拉伸／一扫疲惫·床上练.mp4': { durationSeconds: 1 } }),
      'utf8',
    );

    await execFileAsync('node', [
      CACHE_SCRIPT, 'cache',
      '--videos', videoRoot,
      '--out', catalogDir,
      '--json',
    ]);

    const parsed = JSON.parse(await fsp.readFile(cacheFile, 'utf8')) as Record<string, { durationSeconds: number }>;
    cacheKeys = Object.keys(parsed);

    const thumbnailDir = path.join(catalogDir, 'thumbnails');
    const annotationsFile = path.join(catalogDir, 'annotations.json');
    server = createServer({
      env: {
        VIDEO_ROOT: videoRoot,
        ANNOTATIONS_FILE: annotationsFile,
        THUMBNAIL_DIR: thumbnailDir,
        DIST_DIR: path.join(catalogDir, 'no-such-dist'),
      },
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${portOf(server)}`;
  }, 180_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  it('本机没有 ffmpeg 时整组跳过，而不是假装通过', () => {
    expect(haveFfmpeg, '本机没有 ffmpeg/ffprobe，本组用例无法验证真实时长链路').toBe(true);
  });

  /**
   * 【核心回归守卫】缓存键集合与服务端扫描出的 relativePath 集合**完全相等**。
   *
   * 这条断言就是为 2026-09-28 那次事故写的：症状（全部 available:false）
   * 既可能是「缓存文件不存在」，也可能是「缓存文件存在但一个键都对不上」，
   * 而后者在只看「文件生成了」的验收里完全看不出来。
   * 多一条键 = 服务端永远查不到的幽灵条目；少一条 = 那个视频在网页上就是「暂不可播放」。
   */
  it('缓存键与服务端扫描出的 relativePath 双向严格相等（含 ~ff0f~ 转义名）', async () => {
    const { videos } = await scanVideoRoot(videoRoot);
    const scanned = videos.map((v) => v.relativePath).sort();
    expect(cacheKeys.slice().sort()).toEqual(scanned);
    // 转义名必须真的出现在缓存里（否则这条守卫会在「没有转义名」的空目录上假绿）
    expect(scanned.some((r) => r.includes('~ff0f~'))).toBe(true);
    expect(cacheKeys.some((k) => k.includes('~ff0f~'))).toBe(true);
  });

  it('键必须是转义后的形态，绝不能是源目录原名（含全角 ／）', () => {
    for (const key of cacheKeys) {
      expect(key).not.toContain('／');
      expect(key).not.toContain('/／');
    }
    // 旧缓存里那条按原名写的键必须已经被清掉
    expect(cacheKeys).not.toContain('keep/01 5 分钟睡前全面万能拉伸／一扫疲惫·床上练.mp4');
  });

  it('真实加载缓存后命中率 5/5，且每条时长都等于 ffprobe 实测值', async () => {
    const { videos } = await scanVideoRoot(videoRoot);
    const loaded = await loadDurationCache(cacheFile);
    expect(loaded.present).toBe(true);
    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.map.size).toBe(videos.length);
    for (const video of videos) {
      const seconds = loaded.map.get(video.relativePath);
      expect(seconds, `缓存查不到 ${video.relativePath}`).toBeDefined();
      // 真实片长是 3 秒，允许容器元数据的微小误差
      expect(seconds).toBeGreaterThan(2.5);
      expect(seconds).toBeLessThan(3.5);
    }
  });

  it('GET /api/videos：全部 available=true、时长 > 0、零「缺少时长」诊断', async () => {
    const body = await getJson(`${base}/api/videos`);
    expect(body.videos).toHaveLength(DEPLOYED_FILES.length);
    expect(body.videos.filter((v) => v.available === false)).toHaveLength(0);
    expect(body.videos.every((v) => v.durationSeconds > 0)).toBe(true);
    const missingDuration = body.diagnostics.filter((d) => d.message === MISSING_DURATION_MESSAGE);
    expect(missingDuration).toEqual([]);
  });

  it('/api/health 在有缓存时是 ok:true 且零诊断', async () => {
    const body = (await (await fetch(`${base}/api/health`)).json()) as ApiPayload;
    expect(body.ok).toBe(true);
    expect(body.videoCount).toBe(DEPLOYED_FILES.length);
    expect(body.diagnosticCount).toBe(0);
  });

  it('可重跑：第二次跑全部「与实测一致原样保留」，且键集合不变', async () => {
    const before = await fsp.readFile(cacheFile, 'utf8');
    const { stdout } = await execFileAsync('node', [
      CACHE_SCRIPT, 'cache', '--videos', videoRoot, '--out', catalogDir, '--json',
    ]);
    const report = JSON.parse(stdout) as { counts: { scanned: number; unchanged: number; failed: number } };
    expect(report.counts.scanned).toBe(DEPLOYED_FILES.length);
    expect(report.counts.failed).toBe(0);
    expect(report.counts.unchanged).toBe(DEPLOYED_FILES.length);
    // 全部原样保留 → 文件内容逐字不变（重跑是幂等的，不会无意义地抖动部署产物）
    expect(await fsp.readFile(cacheFile, 'utf8')).toBe(before);
  });

  it('--out 指向没有 annotations.json 的目录时直接拒绝，而不是生成一个没人读的文件', async () => {
    const emptyDir = await makeTempDir('p038-cache-noann-');
    const result = await execFileAsync('node', [
      CACHE_SCRIPT, 'cache', '--videos', videoRoot, '--out', emptyDir,
    ]).then(() => null, (error: { code?: number; stderr?: string }) => ({ code: error.code, stderr: error.stderr }));
    expect(result).not.toBeNull();
    expect(result!.code).toBe(1);
    expect(result!.stderr).toContain('annotations.json');
    // 关键：不能留下一个半成品缓存
    expect(await fsp.readdir(emptyDir)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * B6 诊断收敛：130 条一模一样的噪音 → 1 条能照做的汇总
 * ------------------------------------------------------------------ */

describe('B6 诊断收敛与「没有 ffprobe」的诚实化', () => {
  it('130 条逐条噪音收敛成 1 条汇总，且写清数量、原因和修复命令', () => {
    const noise = Array.from({ length: 130 }, (_, i) => ({
      path: `keep/${i}.mp4`,
      kind: 'metadata' as const,
      message: MISSING_DURATION_MESSAGE,
    }));
    const other = [{ path: '坏文件.mp4.tmp.mp4', kind: 'unreadable' as const, message: '文件名含 .tmp.，已跳过' }];

    const converged = summarizeRaw([...other, ...noise], {
      environment: { ffprobe: 'missing', cacheWritable: 'read-only', detail: '' },
      cacheFile: '/app/catalog/catalog-cache.json',
    });

    expect(converged).toHaveLength(2);
    // 其它种类的诊断必须原样保留（坏文件信息不能被合并掉）
    expect(converged[0]).toEqual(other[0]);
    const summary = converged[1];
    expect(summary.kind).toBe('metadata');
    expect(summary.message).toContain('130');
    expect(summary.message).toContain('暂不可播放');
    expect(summary.message).toContain('没有 ffprobe');
    expect(summary.message).toContain('prepare-videos.mjs cache');
    // 汇总诊断的 path 是「不针对具体文件」，沿用扫描器既有的 '.' 写法
    expect(summary.path).toBe('.');
  });

  it('没有逐条噪音时原样返回（不凭空造诊断）', () => {
    const only = [{ path: 'a.mp4', kind: 'unreadable' as const, message: 'x' }];
    expect(summarizeRaw(only)).toEqual(only);
    expect(summarizeRaw([])).toEqual([]);
    expect(summarizeRaw(undefined as never)).toEqual([]);
  });

  it('汇总文案不泄漏宿主机绝对路径（diagnostics 会原样发给浏览器）', () => {
    const summary = missingDiagnosticRaw({
      total: 3,
      environment: { ffprobe: 'missing', cacheWritable: 'read-only', detail: '' },
      cacheFile: '/Users/someone/DockerData/keep-fitness-workout-repo/catalog/catalog-cache.json',
    });
    expect(summary.message).not.toContain('/Users/someone');
    expect(summary.message).toContain('catalog-cache.json');
  });

  it('「没有 ffprobe」不再被塌缩成 false：环境状态如实区分 missing / broken / ok / unknown', async () => {
    resetProbeAvailability();
    expect(probeEnvRaw().ffprobe).toBe('unknown');

    const savedPath = process.env.PATH;
    try {
      // 模拟容器：镜像里没有 ffprobe。旧实现把这个塌缩成 false，看不出是「没装」。
      process.env.PATH = '/nonexistent-p038';
      resetProbeAvailability();
      const found = await probeDurations([{ relativePath: 'a.mp4', absolutePath: '/x/a.mp4' }]);
      expect(found.size).toBe(0);
      expect(probeEnvRaw().ffprobe).toBe('missing');
    } finally {
      process.env.PATH = savedPath;
      resetProbeAvailability();
    }
  });

  it('标注目录只读时如实记成 read-only，而不是静默放弃', async () => {
    const dir = await makeTempDir('p038-cache-ro-');
    await fsp.chmod(dir, 0o500);
    try {
      resetProbeAvailability();
      const result = await mergeDurations(path.join(dir, 'catalog-cache.json'), new Map([['a.mp4', 12.3]]));
      expect(result).toBe('readonly');
      expect(probeEnvRaw().cacheWritable).toBe('read-only');
    } finally {
      await fsp.chmod(dir, 0o700);
    }
  });

  it('「没什么要补」与「补不进去」不再是同一个 false', async () => {
    const dir = await makeTempDir('p038-cache-ok-');
    resetProbeAvailability();
    const file = path.join(dir, 'catalog-cache.json');
    expect(await mergeDurations(file, new Map())).toBe('unchanged');
    expect(await mergeDurations(file, new Map([['a.mp4', 12.3]]))).toBe('written');
    // 已有正数就不再覆盖
    expect(await mergeDurations(file, new Map([['a.mp4', 99]]))).toBe('unchanged');
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8')) as Record<string, { durationSeconds: number }>;
    expect(parsed['a.mp4'].durationSeconds).toBe(12.3);
  });
});

/* ------------------------------------------------------------------ *
 * B7 诊断收敛真的接线了：buildVideoList 走的是 summarizeMissingDurations
 * ------------------------------------------------------------------ */

describe('B7 缺时长诊断在真实产生点被收敛（buildVideoList）', () => {
  /** 建 N 个假视频，其中 missing 个不给时长，返回 buildVideoList 的 diagnostics。 */
  async function buildWithMissing(total: number, missing: number) {
    const root = await makeTempDir('p038-converge-');
    for (let i = 0; i < total; i += 1) {
      await writeFile(path.join(root, `d${i}`, `${i}.mp4`), VIDEO_BYTES);
    }
    const { videos, diagnostics } = await scanVideoRoot(root);
    const map = new Map<string, number>();
    for (const video of videos) {
      if (Number(video.relativePath.split('/')[0].slice(1)) < missing) continue;
      map.set(video.relativePath, 30);
    }
    const catalogDir = await makeTempDir('p038-converge-cat-');
    const built = await buildVideoList({
      scanned: { videos, diagnostics },
      annotations: await loadAnnotations(path.join(catalogDir, 'annotations.json')),
      durations: { map, file: path.join(catalogDir, 'catalog-cache.json') },
      thumbnailDir: path.join(catalogDir, 'thumbs'),
    });
    return built;
  }

  it('缺 0 个：零条「缺时长」诊断（收敛不能凭空造诊断）', async () => {
    const built = await buildWithMissing(3, 0);
    expect(built.videos).toHaveLength(3);
    expect(built.diagnostics).toEqual([]);
  });

  it('缺 1 个：恰好 1 条，带具体路径和可照做的修复命令', async () => {
    const built = await buildWithMissing(3, 1);
    const missing = built.diagnostics.filter((d) => d.message.startsWith(MISSING_DURATION_MESSAGE));
    expect(missing).toHaveLength(1);
    expect(missing[0].path).toBe(built.videos.find((v) => !v.available)!.relativePath);
    expect(missing[0].kind).toBe('metadata');
    expect(missing[0].message).toContain('prepare-videos.mjs cache');
    expect(built.videos.filter((v) => v.available)).toHaveLength(2);
  });

  it('缺 N 个：收敛成 1 条汇总，不是 N 条一模一样的噪音', async () => {
    const built = await buildWithMissing(130, 130);
    expect(built.videos).toHaveLength(130);
    expect(built.videos.every((v) => v.available === false)).toBe(true);
    expect(built.diagnostics).toHaveLength(1);
    const summary = built.diagnostics[0];
    expect(summary.path).toBe('.');
    expect(summary.message).toContain('130');
    expect(summary.message).toContain('暂不可播放');
    expect(summary.message).toContain('prepare-videos.mjs cache');
    // 汇总文案只报缓存文件名，不泄漏宿主机绝对路径
    expect(summary.message).toContain('catalog-cache.json');
  });

  it('收敛不影响其它种类的诊断（坏文件仍逐条可见）', async () => {
    const root = await makeTempDir('p038-converge-mix-');
    for (let i = 0; i < 5; i += 1) await writeFile(path.join(root, `${i}.mp4`), VIDEO_BYTES);
    await writeFile(path.join(root, '坏的.mp4.tmp.mp4'), VIDEO_BYTES);
    const { videos, diagnostics } = await scanVideoRoot(root);
    // 扫描器诊断由 catalog-service 合并，这里只验证 buildVideoList 产出的那条汇总
    // 不会把「别人已经产生的逐条诊断」当成自己的噪音吃掉。
    const built = await buildVideoList({
      scanned: {
        videos,
        diagnostics: [
          ...diagnostics,
          { path: '坏的.mp4.tmp.mp4', kind: 'unreadable' as const, message: '文件名含 .tmp.，已跳过' },
        ],
      },
      annotations: await loadAnnotations(path.join(root, 'annotations.json')),
      durations: { map: new Map(), file: path.join(root, 'catalog-cache.json') },
      thumbnailDir: path.join(root, 'thumbs'),
    });
    // buildVideoList 只产出自己的诊断（扫描器诊断由 catalog-service 合并），
    // 所以这里只应有那条缺时长汇总；bad-file 那条必须仍以逐条形态存在。
    expect(built.diagnostics).toHaveLength(1);
    expect(built.diagnostics.filter((d) => d.path === '.')).toHaveLength(1);
    expect(built.diagnostics.some((d) => d.message.includes('tmp'))).toBe(false);
    // 逐条形态的 bad-file 诊断原样在 scanned 侧等下游合并
    expect(diagnostics.some((d) => d.kind === 'unreadable' && d.path === '坏的.mp4.tmp.mp4')).toBe(true);
  });
});
