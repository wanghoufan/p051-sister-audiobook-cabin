/**
 * 后台时长探针（可选优化）。
 *
 * 只在后台跑，绝不在 HTTP 请求里跑 ffprobe。
 * 三个必须守住的约束：
 *   1. 进程内只允许一个探针任务在跑（in-flight 标志），避免 /api/rescan 被人连点
 *      就起一串 ffprobe 把小机器的 CPU 吃光。
 *   2. 并发上限 4。ffprobe 本身是 IO 密集的，但全开会在低端机上明显抢占。
 *   3. ffprobe 不存在时**不静默**：见下面「诚实化」一节。
 *
 * 写缓存文件是尽力而为：容器里 catalog 是只读挂载（read_only: true），
 * 写失败只当作「这次没补上」，下次扫描还会再试，绝不能因此让请求失败。
 *
 * ---------------------------------------------------------------------------
 * 诚实化（2026-09-28 线上事故之后）
 * ---------------------------------------------------------------------------
 * 事故：容器里 130 个视频全部 `available:false`、时长 0，网页整站不可用，
 * 而容器 healthy、HTTP 200、videoCount=130 —— 一切「看起来正常」。
 * 根因是本文件**两处静默失败叠加**：
 *   1. `hasFfprobe()` 把「ffprobe 没装」和「ffprobe 装了但跑不动」都塌缩成 `false`，
 *      调用方拿到的只是一个空 Map，看不出原因 —— 而容器镜像（node:22-alpine runner）
 *      是**刻意**不装 ffmpeg 的，这个 `false` 在生产环境是常态而不是意外；
 *   2. `mergeDurationsIntoCache` 写只读挂载失败时也只返回 `false`，
 *      「补不进去」和「没什么要补」在调用方眼里一模一样。
 * 两处都不抛错、不留痕，于是 130 条一模一样的「时长缓存里没有这一条」就成了唯一的线索，
 * 而那条线索既没说是谁的错、也没说该怎么修。
 *
 * 现在：
 *   - 探针的**真实状态**（未探测 / 可用 / 没装 / 装了但跑不动）与**缓存可写性**
 *     都被 `probeEnvironment()` 如实报出来，不再塌缩成一个 false；
 *   - `missingDurationDiagnostic()` 给出**一条**能看懂、能照做的诊断；
 *   - `summarizeMissingDurations()` 把 N 条一模一样的逐条噪音收敛成 1 条汇总。
 * 「什么时候不可用」和「为什么不可用」现在都能从返回值里直接读出来。
 */

import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';

let probeAvailable = null;
let probeFailureReason = null;
let cacheWritable = null;
let cacheWriteFailureReason = null;
let inFlight = null;

export function isProbeRunning() {
  return inFlight !== null;
}

/**
 * 探针与缓存写入的真实状态。
 *
 * 刻意用四个离散值而不是布尔：布尔会把「没装 ffprobe」和「ffprobe 坏了」以及
 * 「还没探测过」压成同一个 false，而这三者要采取的行动完全不同。
 *
 * @returns {{
 *   ffprobe: 'unknown' | 'ok' | 'missing' | 'broken',
 *   cacheWritable: 'unknown' | 'ok' | 'read-only' | 'error',
 *   detail: string,
 * }}
 */
export function probeEnvironment() {
  const ffprobe =
    probeAvailable === null ? 'unknown' : probeAvailable ? 'ok' : probeFailureReason === 'missing' ? 'missing' : 'broken';
  const cache =
    cacheWritable === null ? 'unknown' : cacheWritable ? 'ok' : cacheWriteFailureReason === 'readonly' ? 'read-only' : 'error';
  const notes = [];
  if (probeFailureReason !== null) notes.push(`ffprobe：${probeFailureReason}`);
  if (cacheWriteFailureReason !== null) notes.push(`缓存写入：${cacheWriteFailureReason}`);
  return { ffprobe, cacheWritable: cache, detail: notes.join('；') };
}

async function hasFfprobe() {
  if (probeAvailable !== null) return probeAvailable;
  probeAvailable = await new Promise((resolve) => {
    const child = spawn('ffprobe', ['-version'], { stdio: 'ignore' });
    // ENOENT（根本没装）和「装了但跑不动」必须分开记：前者的行动是「改部署流程，
    // 在宿主机预生成缓存」，后者的行动是「查 ffprobe 本身」。塌缩成一个 false 就没有行动线索了。
    //
    // 注意：ENOENT 时 Node 会**同时**触发 error 和 close(code=null)，
    // 所以 close 分支必须让位给已经判定的 error，否则更具体的原因会被 'broken' 覆盖掉。
    let settledByError = false;
    child.on('error', (error) => {
      settledByError = true;
      probeFailureReason = error && error.code === 'ENOENT' ? 'missing' : 'broken';
      resolve(false);
    });
    child.on('close', (code) => {
      if (settledByError) return;
      if (code === 0) {
        probeFailureReason = null;
        resolve(true);
      } else {
        probeFailureReason = 'broken';
        resolve(false);
      }
    });
  });
  return probeAvailable;
}

/** 只用于测试：重置记忆的探针可用性判断。 */
export function resetProbeAvailability() {
  probeAvailable = null;
  probeFailureReason = null;
  cacheWritable = null;
  cacheWriteFailureReason = null;
  inFlight = null;
}

/** 探测单个文件时长（秒）。失败返回 null，不抛。 */
export function probeOne(absolutePath) {
  return new Promise((resolve) => {
    const child = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', absolutePath],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const seconds = Number.parseFloat(out.trim());
      resolve(Number.isFinite(seconds) && seconds >= 0 ? seconds : null);
    });
  });
}

async function runPool(items, worker, limit) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * 探测一批视频，返回 relativePath -> durationSeconds。
 * 并发调用会复用同一次任务（返回同一个 Promise）。
 *
 * 拿到的 Map 为空时**不代表**「时长是 0」，可能是压根没法探测 ——
 * 用 `probeEnvironment()` 区分这两种情况，别把「环境不具备条件」当成「视频没有时长」。
 * @param {Array<{relativePath: string, absolutePath: string}>} targets
 */
export function probeDurations(targets, { concurrency = 4 } = {}) {
  if (inFlight !== null) return inFlight;
  inFlight = (async () => {
    const found = new Map();
    if (targets.length === 0) return found;
    if (!(await hasFfprobe())) return found;
    const values = await runPool(targets, (target) => probeOne(target.absolutePath), concurrency);
    values.forEach((seconds, index) => {
      if (seconds !== null) found.set(targets[index].relativePath, seconds);
    });
    return found;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * 把新探到的时长合并进缓存文件。
 * 只补缺、不覆盖已有值：缓存是 pipelines 生成的，其它 agent 可能刚写进去更新的数据。
 * 写临时文件再 rename，避免进程被杀时留下半个 JSON。
 *
 * 返回值语义（原来 true/false 二值，区分不出「没东西要补」和「补不进去」）：
 *   'written'  写进去了
 *   'unchanged' 本来就没有缺的，不需要写
 *   'readonly'  目录/文件只读（容器里的常态）
 *   'error'     其它 IO 错误
 */
export async function mergeDurationsIntoCache(cacheFile, found) {
  if (found.size === 0) {
    cacheWritable = cacheWritable ?? true;
    return 'unchanged';
  }
  let existing = {};
  try {
    const text = await fsp.readFile(cacheFile, 'utf8');
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed;
  } catch {
    // 缓存不存在或坏了：当作空对象重新建一份。
  }

  let changed = false;
  for (const [key, seconds] of found) {
    const current = existing[key];
    const currentSeconds =
      typeof current === 'number' ? current : typeof current === 'object' && current !== null ? current.durationSeconds : undefined;
    if (typeof currentSeconds === 'number' && currentSeconds > 0) continue;
    existing[key] = { ...(typeof current === 'object' && current !== null ? current : {}), durationSeconds: seconds };
    changed = true;
  }
  if (!changed) {
    cacheWritable = cacheWritable ?? true;
    return 'unchanged';
  }

  const tmp = `${cacheFile}.${process.pid}.tmp`;
  try {
    await fsp.writeFile(tmp, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, cacheFile);
    cacheWritable = true;
    cacheWriteFailureReason = null;
    return 'written';
  } catch (error) {
    // 只读挂载 / 无权限：**记下原因**，不再静默。内存里的值仍然有效，所以照样不抛。
    await fsp.rm(tmp, { force: true }).catch(() => {});
    cacheWritable = false;
    cacheWriteFailureReason = isReadOnlyError(error) ? 'readonly' : 'error';
    return cacheWriteFailureReason;
  }
}

function isReadOnlyError(error) {
  return Boolean(error) && (error.code === 'EROFS' || error.code === 'EACCES' || error.code === 'EPERM');
}

/* ------------------------------------------------------------------ *
 * 诊断文案与收敛
 * ------------------------------------------------------------------ */

/**
 * 逐条「时长缓存里没有这一条」的原始文案。
 * `server/catalog-build.mjs` 目前把同一句话硬编码在源码里；这里导出常量，
 * 是为了让「逐条文案」和「汇总文案」永远指向同一件事，收敛时才不会漏判。
 */
export const MISSING_DURATION_MESSAGE = '时长缓存里没有这一条，无法确认时长与可播放性';

/** 汇总诊断用的 path：沿用扫描器「不是某一个具体文件」的既有写法（server/catalog-scan.mjs 也用 '.'）。 */
const SUMMARY_PATH = '.';

/**
 * 「既没有时长缓存、又没法自己探测」时的**唯一**诊断。
 *
 * 目标是让维护者读完就能动手，而不是读完只知道「有问题」：
 * 说清影响范围（多少个视频会显示成什么样）、说清根因（容器里没 ffprobe + 标注目录只读）、
 * 再给出一条可直接粘贴的命令。
 *
 * @param {object} input
 * @param {number} input.total 缺时长的视频条数
 * @param {ReturnType<typeof probeEnvironment>} [input.environment]
 * @param {string} [input.cacheFile] 缓存文件路径（只报 basename，不泄漏宿主机绝对路径）
 */
export function missingDurationDiagnostic({ total, environment = probeEnvironment(), cacheFile } = {}) {
  const count = Number.isFinite(total) ? total : 0;
  const reasons = [];
  if (environment.ffprobe === 'missing') {
    reasons.push('容器镜像里没有 ffprobe（运行镜像刻意不装 ffmpeg）');
  } else if (environment.ffprobe === 'broken') {
    reasons.push('ffprobe 存在但跑不起来');
  } else if (environment.ffprobe === 'unknown') {
    reasons.push('尚未确认本机能否探测时长');
  }
  if (environment.cacheWritable === 'read-only') {
    reasons.push('标注目录是只读挂载，服务端无法把补到的时长写回缓存');
  }

  const where = cacheFile === undefined || cacheFile === null ? '' : `（缓存文件 ${basenameOf(cacheFile)}）`;
  const fix =
    '请在**宿主机**上预生成时长缓存：\n' +
    '    node scripts/prepare-videos.mjs cache --videos <播放文件根目录> --out <标注目录>\n' +
    '然后重建容器（时长缓存必须随部署一起挂进 APP_CATALOG_DIR）。';

  return {
    path: SUMMARY_PATH,
    kind: 'metadata',
    message:
      `共 ${count} 个视频缺少时长缓存${where}，网页上它们会全部显示「暂不可播放」、时长显示「—」，` +
      `筛选与播放都不可用。服务端无法自行修复：${reasons.join('；')}。${fix}`,
  };
}

/**
 * 把 N 条一模一样的「时长缓存里没有这一条」收敛成 1 条汇总诊断。
 *
 * 为什么必须收敛：一个 130 条的视频库会产出 130 条逐字相同的噪音，
 * 维护者既看不出共性、也定位不到根因，等于没有线索。
 * 收敛后只剩一条，且那条写清了数量、影响、原因和修复命令。
 *
 * 纯函数：不改传入的数组，只返回新数组，便于单测与复用。
 * 非该文案的诊断原样保留（坏文件、重复 id 等仍然是逐条信息，不能被合并掉）。
 *
 * @param {object[]} diagnostics
 * @param {{environment?: object, cacheFile?: string}} [options]
 */
export function summarizeMissingDurations(diagnostics, { environment, cacheFile } = {}) {
  if (!Array.isArray(diagnostics)) return [];
  const isMissingDuration = (d) => d && d.kind === 'metadata' && d.message === MISSING_DURATION_MESSAGE;
  const missing = diagnostics.filter(isMissingDuration);
  if (missing.length === 0) return [...diagnostics];
  const kept = diagnostics.filter((d) => !isMissingDuration(d));
  kept.push(missingDurationDiagnostic({ total: missing.length, environment, cacheFile }));
  return kept;
}

function basenameOf(file) {
  const text = String(file);
  const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  return index === -1 ? text : text.slice(index + 1);
}
