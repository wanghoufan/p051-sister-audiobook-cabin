// 路径处理：把源目录的相对路径映射成目标目录的相对路径。
//
// 为什么需要转义：局域网服务要按 URL 传相对路径，而源文件名里混着
// `】`、`丨`、`／`、`+`、`（）` 和空格。绝大多数是可读的 Unicode，可以原样保留；
// 但真路径分隔符 `/`、控制字符、Windows 保留字符，以及全角 `／`（U+FF0F，
// 在部分 NFC/视觉等价归一化或浏览器/文件系统桥接里会被当成 `/`）必须转义，
// 否则会产生路径穿越、请求穿越或目录被拆开的故障。
//
// 转义方案用 `~hhhh~`（4 位十六进制）承载被转义的码位，`~` 本身也在转义集合里，
// 所以映射是单射、可逆、稳定的：同样的源路径永远得到同样的目标名。
// 未被转义的字符（中文、空格、`】`、`丨`、`·` 等）一律原样保留，不丢字。

const ESCAPE_INTRODUCERS = new Set([
  '/', // POSIX 路径分隔符
  '\\', // Windows 路径分隔符
  ':', '*', '?', '"', '<', '>', '|', // Windows 保留字符
  '~', // 转义符自身，必须一起转义才能保证单射
]);

// 全角/易被归一化成 ASCII 分隔符的码位
const LOOKALIKE_SEPARATOR = '／'; // ／

// 控制字符与 DEL
const CONTROL = /^[\u0000-\u001f\u007f]$/;

function needsEscape(ch) {
  if (CONTROL.test(ch)) return true;
  if (ch === LOOKALIKE_SEPARATOR) return true;
  return ESCAPE_INTRODUCERS.has(ch);
}

/** 把单个路径段（不含分隔符）转义成安全的一段。 */
export function sanitizeSegment(segment) {
  let out = '';
  for (const ch of segment) {
    if (needsEscape(ch)) {
      out += `~${ch.codePointAt(0).toString(16).padStart(4, '0')}~`;
    } else {
      out += ch;
    }
  }
  // 段首尾的点和空格在 Windows/某些 SMB 挂载上会被吞掉；点开头还会变成隐藏文件
  out = out.replace(/^[.\s]+/, '_').replace(/[.\s]+$/, '_');
  if (out === '' || out === '.') out = '_';
  return out;
}

/** 拆扩展名：只认最后一段 `.xxx`，避免把 `a.mp4.tmp.mp4` 的 stem 算错。 */
export function splitExtension(basename) {
  const i = basename.lastIndexOf('.');
  if (i <= 0) return { stem: basename, ext: '' };
  return { stem: basename.slice(0, i), ext: basename.slice(i) };
}

/**
 * 源相对路径 → 目标相对路径。
 * 目录结构镜像，但每一段都过一遍 sanitizeSegment，所以目标树里的每一段都是安全的。
 * 扩展名统一为 `.mp4`（本任务只处理 mp4 源）。
 */
export function targetRelativePath(relSourcePath) {
  const parts = relSourcePath.split('/').filter((p) => p !== '');
  const last = parts[parts.length - 1];
  const { stem } = splitExtension(last);
  const outParts = parts.slice(0, -1).map(sanitizeSegment);
  outParts.push(`${sanitizeSegment(stem)}.mp4`);
  return outParts.join('/');
}

// 注意：这里刻意**没有**提供 thumbRelativePath(targetRelPath) 这类"再转义一次"的函数。
// targetRelativePath 的输出已经是转义后的形态，再过一遍 sanitizeSegment 会把 `~hhhh~` 里的
// `~` 继续转义，得到错误路径。缩略图命名规则是"在已转义的目标路径上换扩展名"，
// 由 prepare-videos.mjs 的 thumbnail 子命令直接实现（见那里的约定注释）。

/**
 * 目标目录内的去重：如果两个源文件 sanitize 后落到同一个目标名，
 * 依次尝试 `~d1~`、`~d2~` …… 保证一一对应且可重跑。
 */
export function uniqueTarget(relTargetPath, taken) {
  if (!taken.has(relTargetPath)) return relTargetPath;
  const { stem, ext } = splitExtension(relTargetPath.split('/').pop());
  const parts = relTargetPath.split('/');
  parts.pop();
  for (let i = 1; i < 1000; i += 1) {
    const candidate = [...parts, `${stem}~d${i}~${ext}`].join('/');
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`无法为 ${relTargetPath} 找到唯一目标名`);
}
