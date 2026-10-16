/**
 * 稳定 id 的生成。
 *
 * 契约（前后端共同遵守，不许单方面改）：
 *   relativePath 做 NFC 规范化 + `\`→`/` + 去掉前导 `./`，然后 sha1 前 16 位十六进制。
 *
 * 为什么是路径的哈希而不是随机 id / 数组下标：
 *   - 服务重启、重扫目录后 id 不变，前端可以安全地把 id 存进 localStorage 当收藏；
 *   - 只依赖相对路径，不含绝对路径，浏览器拿不到任何宿主机目录信息。
 * 代价：文件改名 = 新 id（历史收藏会失效）。这是刻意的取舍，
 * 因为「同一个文件改名后悄悄换了 id」比「改名后重新标一次」更难排查。
 */

import { createHash } from 'node:crypto';
import path from 'node:path';

export const ID_LENGTH = 16;
const ID_PATTERN = /^[0-9a-f]{16}$/;

/** 规范化相对路径：NFC + 正斜杠 + 去前导 `./`。非字符串返回空串。 */
export function normalizeRelativePath(input) {
  if (typeof input !== 'string' || input.length === 0) return '';
  let value = input.normalize('NFC').replace(/\\/g, '/');
  while (value.startsWith('./')) value = value.slice(2);
  if (value === '.' || value === './') return '';
  return value;
}

/** 由规范化相对路径生成 16 位十六进制 id。相同输入永远得到相同输出。 */
export function makeVideoId(relativePath) {
  return createHash('sha1')
    .update(normalizeRelativePath(relativePath), 'utf8')
    .digest('hex')
    .slice(0, ID_LENGTH);
}

/** URL 里的 id 段是否合法。故意收得很紧：只放行 16 位小写十六进制，
 *  这样 `..`、绝对路径、URL 编码穿越、路径分隔符统统在解析阶段就被拒掉。 */
export function isValidVideoId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** 把绝对路径转成相对根目录的 posix 相对路径。 */
export function relativePosix(rootResolved, absolutePath) {
  return normalizeRelativePath(path.relative(rootResolved, absolutePath));
}

/** 目录相对路径（用于 defaultTypes 兜底查找）：`a/b/c.mp4` → `a/b`；根下文件 → `''`。 */
export function parentDirectory(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

/** 目录相对路径的各级祖先，从最深往最浅（不含自身），用于 defaultTypes 逐级回退。 */
export function ancestorDirectories(relativeDir) {
  const out = [];
  let current = relativeDir;
  while (current.length > 0) {
    const index = current.lastIndexOf('/');
    if (index === -1) break;
    current = current.slice(0, index);
    out.push(current);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 路径转义：源目录原名 ↔ 部署目录文件名
 * ------------------------------------------------------------------ *
 *
 * 背景：`scripts/prepare-videos.mjs` 产出的部署目录里，每一段路径都过了
 * `scripts/vid-paths.mjs` 的 `sanitizeSegment`，把会造成路径穿越 / 目录被拆开的
 * 码位转义成 `~hhhh~`（4 位小写十六进制码位，两端各一个 `~`）。于是部署态的
 * `relativePath` 形如 `keep/01 …拉伸~ff0f~一扫疲惫·床上练.mp4`，
 * 而 `catalog/annotations.json` 的键按 README 约定是**源目录原名**（含全角 `／`）。
 * 服务端要拿「部署态路径」去查「原名标注」，就必须能双向换算。
 *
 * 下面这两个函数是 `scripts/vid-paths.mjs` 的**逐条复刻**（只读参考，未修改），
 * 映射表与那边必须一字不差：
 *
 *   | 触发条件                                   | 转义结果    |
 *   |-------------------------------------------|-------------|
 *   | `/`  U+002F                                | `~002f~`   |
 *   | `\`  U+005C                                | `~005c~`   |
 *   | `:` `*` `?` `"` `<` `>` `|`（Windows 保留） | `~003a~` `~002a~` `~003f~` `~0022~` `~003c~` `~003e~` `~007c~` |
 *   | `~`  U+007E（转义符自身，保证单射可逆）    | `~007e~`   |
 *   | 全角 `／` U+FF0F（易被归一化成 `/`）       | `~ff0f~`   |
 *   | C0 控制字符 U+0000–U+001F                  | `~00xx~`   |
 *   | DEL U+007F                                 | `~007f~`   |
 *   | 其余字符（中文、空格、`】`、`丨`、`·`、`+`、`（）`…）| 原样保留 |
 *
 * 另有两条段级规则（同样照抄）：转义后把**段首尾**的 `[.\s]+` 换成单个 `_`，
 * 结果为空或 `.` 时也用 `_`。末段先剥掉最后一个 `.xxx` 再转义、最后固定接回 `.mp4`。
 *
 * 一致性怎么保证（重要）：
 *   1. 规则本身是数据无关的闭集（上面这张表就是全部），照抄即可；
 *   2. 不靠注释兜底 —— `tests/qa/contract.test.ts` 有一条**跨实现等价测试**，
 *      把真实 130 个源键 + 全部边界串（控制字符、Windows 保留字符、`~` 自身、
 *      连续分隔符、段首尾点与空格、大小写 hex）逐一与 `scripts/vid-paths.mjs`
 *      的 `sanitizeSegment` / `targetRelativePath` 对拍，两边不一致就直接红。
 *      脚本加映射 / 改规则时，那条测试会先失败，而不是等到线上标题出现机器噪音。
 *   3. 本文件**没有**采用「见到 `~ff0f~` 就换成 `／`」的单向硬编码还原：那种写法
 *      与上表是 N 条手工对齐，脚本加第 N+1 条映射时就会静默失配。这里做的是
 *      正向转义（建索引）+ 反向还原（兜底标题）两套通用函数，规则只有这一份。
 */

/** 需要转义的字符：控制字符 / DEL。 */
const CONTROL_PATTERN = /^[\u0000-\u001f\u007f]$/;

/** 需要转义的「自带分隔符或保留字符」集合。`~` 自身也在内，否则映射不可逆。 */
const ESCAPE_INTRODUCERS = new Set([
  '/',
  '\\',
  ':',
  '*',
  '?',
  '"',
  '<',
  '>',
  '|',
  '~',
]);

/** 全角 `／`：某些归一化 / 文件系统桥接里会被当成 ASCII `/`，必须转义。 */
const LOOKALIKE_SEPARATOR = '／';

function needsEscape(ch) {
  if (CONTROL_PATTERN.test(ch)) return true;
  if (ch === LOOKALIKE_SEPARATOR) return true;
  return ESCAPE_INTRODUCERS.has(ch);
}

/** 单个路径段的转义（等价于 `scripts/vid-paths.mjs` 的 `sanitizeSegment`）。 */
export function escapeSegment(segment) {
  let out = '';
  for (const ch of segment) {
    out += needsEscape(ch) ? `~${ch.codePointAt(0).toString(16).padStart(4, '0')}~` : ch;
  }
  out = out.replace(/^[.\s]+/, '_').replace(/[.\s]+$/, '_');
  if (out === '' || out === '.') out = '_';
  return out;
}

/** 源相对路径 → 部署态相对路径（等价于 `targetRelativePath`）。 */
export function escapeRelativePath(relativePath) {
  const parts = normalizeRelativePath(relativePath).split('/').filter((p) => p !== '');
  if (parts.length === 0) return '';
  const last = parts[parts.length - 1];
  const dot = last.lastIndexOf('.');
  const stem = dot <= 0 ? last : last.slice(0, dot);
  const out = parts.slice(0, -1).map(escapeSegment);
  out.push(`${escapeSegment(stem)}.mp4`);
  return out.join('/');
}

/**
 * 目录相对路径的转义：每段各转义一次，但**不**碰扩展名（目录名没有扩展名可言，
 * 硬套 `escapeRelativePath` 会给末段加一个 `.mp4`，那是错的）。
 */
export function escapeRelativeDirectory(relativeDir) {
  return normalizeRelativePath(relativeDir)
    .split('/')
    .filter((p) => p !== '')
    .map(escapeSegment)
    .join('/');
}

/** `~hhhh~` 转义序列。hex 固定 4 位小写，与 escapeSegment 的产出严格互逆。 */
const ESCAPE_TOKEN = /~([0-9a-f]{4})~/g;

/** 单个路径段的还原（`escapeSegment` 的逆运算）。 */
export function unescapeSegment(segment) {
  return segment.replace(ESCAPE_TOKEN, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

/**
 * 相对路径的还原：把每一段里的 `~hhhh~` 换回原字符。
 *
 * 故意用「宽松」还原（任何 `~hhhh~` 都还原，不检查解出来的字符是否真的需要转义）：
 * 因为源文件名里**字面写着** `~0041~` 的情况，转义后是 `~007e~0041~007e~`，
 * 每个字面 `~` 自己变成了一个完整 token，逐段左到右扫描时不会跨 token 误配，
 * 所以宽松还原对 `escapeSegment` 是严格逆运算（逐条对拍见 tests/qa/contract.test.ts）。
 * 收紧成「只还原需要转义的码位」反而会在脚本将来加新映射时静默失配 —— 那正是我们要避免的。
 */
export function unescapeRelativePath(relativePath) {
  return normalizeRelativePath(relativePath)
    .split('/')
    .map(unescapeSegment)
    .join('/');
}
