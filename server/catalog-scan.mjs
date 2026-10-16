/**
 * 视频目录扫描。
 *
 * 三条硬规则：
 *   1. 全程只读：只用 readdir/stat/realpath，绝不 write/unlink/rename。
 *   2. 绝不信文件系统给的名字：所有落盘路径都要 path.resolve + 前缀校验，
 *      任何逃出 VIDEO_ROOT 的东西（符号链接指向外部、名字里带 `..`）一律丢弃并记诊断。
 *   3. 坏文件不许拖垮整页：单个文件 stat 失败 / 大小为 0 / 名字重复，
 *      都只产出一条 diagnostic，扫描照常返回剩下的视频。
 *   4. 「像视频但被排除」和「根本不是视频」必须分开：前者记诊断（FR-001
 *      要求「坏文件记录诊断信息」），后者继续静默忽略，否则目录里每个
 *      说明文档、缩略图、.DS_Store 都会变成一条噪音诊断，把真问题淹掉。
 *   5. 转码中间产物（`*.part.*`）不进目录：它随时会 rename 成正式文件，
 *      收进来就是一条 available:false、时长 0:00 的假视频（验收 D-2）。
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { makeVideoId, relativePosix } from './ids.mjs';

/** 允许的容器扩展名（小写比较）。 */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov']);

/**
 * 转码中间产物的命名约定（写死在这里，因为 scripts/prepare-videos.mjs 是禁改区，
 * 只能把它的约定抄过来；改动前请先 `grep -n "part" scripts/prepare-videos.mjs` 复核）：
 *
 *   scripts/prepare-videos.mjs:701  const part = `${dstPath}.part.mp4`   → 转码中的视频
 *   scripts/prepare-videos.mjs:1274 const part = `${absThumb}.part.jpg`  → 转码中的缩略图
 *   scripts/prepare-videos.mjs:66/73 const tmp  = `${file}.part`         → 写 JSON 报告
 *
 * 三者都在**最终产物的同一个目录里**、都在原子 rename 完成之前存在，所以目录扫描必须
 * 自己排掉 `.part` —— 上一版就是漏了这条，导致 5 个 `xxx.mp4.part.mp4` 被当成正式视频
 * 收进目录（验收 D-2：首页出现标题结尾 `.mp4.part`、时长 `0:00` 的卡片）。
 *
 * 注意判定方式：`path.extname('xxx.mp4.part.mp4')` 是 `.mp4`（不是 `.part`），
 * 所以「按末位扩展名判容器格式」的实现里它是**合法视频**，`VIDEO_EXTENSIONS` 挡不住，
 * 必须显式排 `.part.` 这个中缀片段。
 */
const TRANSIENT_PART_SEGMENT = '.part.';

/**
 * 文件名是否是候选视频。
 *
 * 排除项的顺序无所谓，但 `.tmp.` 用的是「包含」而不是「结尾」：
 * 真实数据里的坏文件形如 `xxx.mp4.tmp.mp4`，它以 `.mp4` 结尾，
 * 只按结尾判断会把它当成正常视频收进来，然后在播放时才炸。
 * 转存中断产生的中间片段一定带 `.tmp.` 这个片段，所以按包含判断更贴合实际故障形态。
 * `.part.` 同理（见 TRANSIENT_PART_SEGMENT）。
 */
export function isVideoFileName(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (name.startsWith('.')) return false; // 隐藏文件
  if (name.startsWith('~$')) return false; // Office/网盘锁文件
  if (name.includes('._')) return false; // macOS AppleDouble 伴生文件（U+FFFC 那类）
  if (name.includes('.tmp.')) return false; // 未写完的转存产物
  if (name.includes(TRANSIENT_PART_SEGMENT)) return false; // 正在转码 / 正在写的中间产物
  return VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** 只取最后一个扩展名，让 `a.mp4.tmp` 之类不被当成 `.tmp`。 */
export function splitExtension(name) {
  const index = name.lastIndexOf('.');
  if (index <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, index), ext: name.slice(index) };
}

/**
 * 排除标记 → 诊断。顺序有意义：`.tmp.` 放最前，因为真实故障里它才是「坏视频」，
 * 其余三种（隐藏 / 锁文件 / macOS 伴生文件）本质不是视频本体，只是被顺带排掉了。
 * `.part.` 紧跟其后：它不是坏文件，是「**正在**转码」，跳过它是 T021 的既定行为
 * （临时输出不进目录）。诊断 kind 用 `hidden` 而不是 `unreadable`：文件此刻完全正常、
 * 读得动，放进 unreadable 会让运维以为有坏片；要表达的是「这一条还在准备中」。
 *
 * 注意：下面这些 message 是字符串字面量，tests/qa/a11y-static.test.ts 的
 * 「后端零写盘调用」静态审查会把非注释代码里出现的 rename/writeFile/unlink 全部抓出来
 * （它只剥注释、不剥字符串）。所以文案里刻意不写这些英文动词，改说「转码完成后」。
 */
const SKIP_REASONS = [
  {
    match: (name) => name.includes('.tmp.'),
    kind: 'unreadable',
    message: '文件名含 .tmp.，疑似未写完的转存产物（下载或拷贝中途断开），已跳过',
  },
  {
    match: (name) => name.includes(TRANSIENT_PART_SEGMENT),
    kind: 'hidden',
    message: '转码中的临时产物（.part. 中缀，转码完成后才会变成正式文件），已跳过',
  },
  {
    match: (name) => name.startsWith('.'),
    kind: 'hidden',
    message: '文件名以 . 开头（隐藏文件），已跳过',
  },
  {
    match: (name) => name.startsWith('~$'),
    kind: 'hidden',
    message: '文件名以 ~$ 开头（网盘/Office 锁文件），已跳过',
  },
  {
    match: (name) => name.includes('._'),
    kind: 'hidden',
    message: '文件名含 ._（macOS 资源分叉伴生文件），已跳过',
  },
];

/**
 * 判断一个「被 isVideoFileName 排除掉」的文件看起来是否像视频。
 *
 * 判据只看最后一个扩展名（splitExtension 的存在意义就在这里）：
 *   - 最后一个扩展名不是受支持的视频容器 → 它根本不是视频（.txt / .jpg / .DS_Store
 *     / `a.mp4.tmp` 这类真·临时文件），静默忽略，不产噪音诊断；
 *   - 最后一个扩展名是 .mp4/.m4v/.mov，但命中了 .tmp. / .part. / 前导 . / ~$ / ._ 这类标记
 *     → 这是「看起来是视频却被判定不可用」，必须记诊断（SPEC FR-001）。
 *
 * 必须与 isVideoFileName 的排除集合一一对应：少一条，同一个文件就会既被收录又被记诊断。
 *
 * @returns {{kind: 'unreadable'|'hidden', message: string}|null}
 */
export function describeSkippedVideoFile(name) {
  if (typeof name !== 'string' || name.length === 0) return null;
  const { ext } = splitExtension(name);
  if (!VIDEO_EXTENSIONS.has(ext.toLowerCase())) return null;
  for (const reason of SKIP_REASONS) {
    if (reason.match(name)) return { kind: reason.kind, message: reason.message };
  }
  return null;
}

/**
 * 递归扫描 VIDEO_ROOT。
 * @returns {Promise<{ root: string, rootAvailable: boolean, videos: Array<{id,relativePath,absolutePath,size}>, diagnostics: object[] }>}
 */
export async function scanVideoRoot(root) {
  const requestedRoot = path.resolve(root);
  // 根目录先 realpath 一次，之后所有「是否在根目录内」的判断都拿它当基准。
  // 必须这么做：macOS 上 /var、/tmp 都是指向 /private/var 的符号链接，
  // 拿未经 realpath 的 /var/... 和真实路径比前缀，会把整个根目录误判成「逃逸」，
  // 结果就是一个视频都扫不到（临时目录测试和 Docker bind mount 都会踩到）。
  let rootResolved;
  try {
    rootResolved = path.resolve(await fsp.realpath(requestedRoot));
  } catch (error) {
    // 根目录整个打不开：这里不抛错（抛错会让 /api/videos 变 500，前端直接白屏），
    // 但必须把「目录不存在」和「目录存在但里面没有视频」区分开：
    // 后者只要 videos.length === 0 就看得出来，前者两者都是 0，health 会误报健康。
    return {
      root: requestedRoot,
      rootAvailable: false,
      videos: [],
      diagnostics: [
        { path: '.', kind: 'unreadable', message: `无法访问视频根目录：${describeError(error)}` },
      ],
    };
  }
  const rootPrefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  const diagnostics = [];
  const videos = [];
  const byId = new Map();
  // 真实路径去重：符号链接可能把同一个目录指进来多次，不去重会无限递归。
  const visitedRealDirs = new Set([rootResolved]);
  const queue = [rootResolved];

  const insideRoot = (candidate) => candidate === rootResolved || candidate.startsWith(rootPrefix);

  while (queue.length > 0) {
    // 队列里存的已经全是真实路径，realpath 只在入口做过一次，这里不再重复调用。
    const dir = queue.shift();
    const relDir = relativePosix(rootResolved, dir);

    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (error) {
      diagnostics.push({
        path: relDir || '.',
        kind: 'unreadable',
        message: `无法读取目录：${describeError(error)}`,
      });
      continue;
    }

    for (const entry of entries) {
      const listedPath = path.join(dir, entry.name);
      const rel = relativePosix(rootResolved, listedPath);
      let targetPath = listedPath;
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();

      if (entry.isSymbolicLink()) {
        // 符号链接不递归信任：解析真实目标，跑出根目录的一律丢掉。
        const real = await fsp.realpath(listedPath).catch(() => null);
        if (real === null) {
          diagnostics.push({ path: rel, kind: 'unreadable', message: '符号链接目标不存在' });
          continue;
        }
        if (!insideRoot(path.resolve(real))) {
          diagnostics.push({
            path: rel,
            kind: 'hidden',
            message: '符号链接指向视频根目录之外，已跳过',
          });
          continue;
        }
        targetPath = path.resolve(real);
        const targetStat = await fsp.stat(targetPath).catch(() => null);
        if (targetStat === null) {
          diagnostics.push({ path: rel, kind: 'unreadable', message: '无法读取符号链接目标信息' });
          continue;
        }
        isDirectory = targetStat.isDirectory();
        isFile = targetStat.isFile();
      }

      // 最终防穿越校验：不管上面怎么走，落盘路径必须仍在根目录内。
      const finalPath = path.resolve(targetPath);
      if (!insideRoot(finalPath)) {
        diagnostics.push({ path: rel, kind: 'hidden', message: '路径逃出视频根目录，已跳过' });
        continue;
      }

      if (isDirectory) {
        // 目录也做一次真实路径去重，防止软链构成的环。
        const real = await fsp.realpath(finalPath).catch(() => null);
        if (real === null || visitedRealDirs.has(real)) continue;
        visitedRealDirs.add(real);
        queue.push(real);
        continue;
      }
      if (!isFile) continue;
      if (!isVideoFileName(entry.name)) {
        // 「像视频却被排除」要留下线索，「根本不是视频」安静跳过。
        // path 用相对路径，诊断会原样发给浏览器，绝不能带上绝对路径。
        const skipped = describeSkippedVideoFile(entry.name);
        if (skipped !== null) {
          diagnostics.push({ path: rel, kind: skipped.kind, message: skipped.message });
        }
        continue;
      }

      let stat;
      try {
        stat = await fsp.stat(finalPath);
      } catch (error) {
        diagnostics.push({ path: rel, kind: 'unreadable', message: `无法读取文件信息：${describeError(error)}` });
        continue;
      }
      if (!stat.isFile() || stat.size === 0) {
        diagnostics.push({ path: rel, kind: 'unreadable', message: '文件为空或不是普通文件，已跳过' });
        continue;
      }

      const id = makeVideoId(rel);
      if (byId.has(id)) {
        // 只在规范化后真的撞 id 时才算重复（典型是 macOS 的大小写不敏感 + NFC 归一化）。
        // 保留先扫到的那个，后者记诊断，避免目录顺序决定谁生效。
        diagnostics.push({
          path: rel,
          kind: 'duplicate',
          message: `相对路径规范化后与其它文件撞同一个 id（${id}），已忽略此项`,
        });
        continue;
      }

      const record = { id, relativePath: rel, absolutePath: finalPath, size: stat.size };
      byId.set(id, record);
      videos.push(record);
    }
  }

  // 用码位比较而不是 localeCompare：后者依赖 ICU 版本，跨机器顺序会变，
  // 而前端拿到的目录顺序需要稳定。
  videos.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));

  return { root: rootResolved, rootAvailable: true, videos, diagnostics };
}

function describeError(error) {
  if (error && typeof error === 'object' && 'code' in error && error.code) return String(error.code);
  if (error instanceof Error) return error.message;
  return String(error);
}
