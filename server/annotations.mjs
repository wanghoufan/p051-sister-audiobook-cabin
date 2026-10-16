/**
 * 标注文件的读取与校验。
 *
 * 立场（SPEC 原则 IV：诚实标签）：
 *   标注里出现非法值时，绝不「猜一个默认值」蒙混过去。
 *   非法字段就地作废 + 记 metadata 诊断；整条标注都没有合法值时，
 *   结果退化成 `types: []` / `level: null`。
 *   谎称「初级」比什么都不标伤害大得多。
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  ancestorDirectories,
  escapeRelativeDirectory,
  escapeRelativePath,
  normalizeRelativePath,
  parentDirectory,
  unescapeRelativePath,
} from './ids.mjs';

export const VIDEO_TYPES = Object.freeze(['cardio', 'upper', 'lower', 'fullbody', 'core', 'stretch', 'balance', 'running', 'pilates', 'sleep', 'yoga', 'baduanjin']);

/**
 * 课程封面原图上印的等级。**必须与 src/lib/types.ts 的 LEVEL_ORDER 逐条一致。**
 *
 * 等级**只有一个来源：课程封面原图**。识别结果没到位就留空（null），
 * 绝不由类型标签、文件名或任何其它字段推导。
 */
export const LEVELS = Object.freeze(['K1', 'K2', 'K3', 'K4', 'K5']);

const TYPE_SET = new Set(VIDEO_TYPES);
const LEVEL_SET = new Set(LEVELS);

/** 校验一串 types：只保留合法值，非法值逐个报诊断。 */
function validateTypes(raw, where, diagnostics) {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) {
    diagnostics.push({ path: where, kind: 'metadata', message: 'types 必须是数组，已忽略该字段' });
    return null;
  }
  const out = [];
  for (const item of raw) {
    if (typeof item === 'string' && TYPE_SET.has(item)) {
      if (!out.includes(item)) out.push(item);
    } else {
      diagnostics.push({
        path: where,
        kind: 'metadata',
        message: `types 里的 ${JSON.stringify(item)} 不是合法类型（合法值：${VIDEO_TYPES.join(' / ')}），已忽略`,
      });
    }
  }
  return out;
}

/**
 * 校验 level（K1–K5）：非法值不落库，直接当没有这一项（→ 前端拿到 null）。
 *
 * **不做任何兜底推导**：绝不在这里写「没有 level 就按类型或文件名推一个」，
 * 识别结果没到位就是没到位。
 */
function validateLevel(raw, where, diagnostics) {
  if (raw === undefined) return null;
  if (typeof raw === 'string' && LEVEL_SET.has(raw)) return raw;
  diagnostics.push({
    path: where,
    kind: 'metadata',
    message: `level ${JSON.stringify(raw)} 不是合法等级（合法值：${LEVELS.join(' / ')}），已忽略`,
  });
  return null;
}

function validateTitle(raw, where, diagnostics) {
  if (raw === undefined) return null;
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  diagnostics.push({ path: where, kind: 'metadata', message: 'title 不是非空字符串，已忽略' });
  return null;
}

/**
 * 读取并校验标注文件。
 * 文件不存在不算错误：服务仍可用，只是全部视频都是「待标注」。
 *
 * 键有两套形态，必须都留着：
 *   - `videos` / `defaultTypes`：标注里的**原始键**（源目录原名，可能含全角 `／`）。
 *     VIDEO_ROOT 直接指源目录时用它。
 *   - `videosByTarget` / `defaultTypesByTarget`：同一批标注按 prepare 的转义规则
 *     预先算出的**部署态键**（`…~ff0f~…`）。VIDEO_ROOT 指向 prepare 产出的部署目录时用它。
 * 查找见 `findAnnotation`。
 * @returns {Promise<{file:string,present:boolean,videos:Map<string,object>,defaultTypes:Map<string,string[]>,videosByTarget:Map<string,{sourceKey:string,entry:object}>,defaultTypesByTarget:Map<string,string[]>,diagnostics:object[]}>}
 */
export async function loadAnnotations(file) {
  // 诊断里只放文件名，不放绝对路径：diagnostics 会原样发给浏览器。
  const label = path.basename(file);
  const empty = {
    file,
    present: false,
    videos: new Map(),
    defaultTypes: new Map(),
    videosByTarget: new Map(),
    defaultTypesByTarget: new Map(),
    diagnostics: [],
  };

  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return empty;
    return {
      ...empty,
      diagnostics: [{ path: label, kind: 'metadata', message: `无法读取标注文件：${code(error)}` }],
    };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return {
      ...empty,
      present: true,
      diagnostics: [{ path: label, kind: 'metadata', message: `标注文件不是合法 JSON：${message(error)}` }],
    };
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      ...empty,
      present: true,
      diagnostics: [{ path: label, kind: 'metadata', message: '标注文件顶层应该是对象，已按空标注处理' }],
    };
  }

  const diagnostics = [];
  const videos = new Map();
  const defaultTypes = new Map();
  const videosByTarget = new Map();
  const defaultTypesByTarget = new Map();

  const rawVideos =
    typeof data.videos === 'object' && data.videos !== null && !Array.isArray(data.videos) ? data.videos : {};
  if (data.videos !== undefined && (typeof data.videos !== 'object' || data.videos === null || Array.isArray(data.videos))) {
    diagnostics.push({ path: label, kind: 'metadata', message: 'videos 字段必须是对象，已按空标注处理' });
  }

  for (const [rawKey, rawValue] of Object.entries(rawVideos)) {
    const key = normalizeRelativePath(rawKey);
    if (key.length === 0) {
      diagnostics.push({ path: label, kind: 'metadata', message: '存在空的 relativePath 标注键，已忽略' });
      continue;
    }
    if (typeof rawValue !== 'object' || rawValue === null || Array.isArray(rawValue)) {
      diagnostics.push({ path: key, kind: 'metadata', message: '标注值必须是对象，已忽略整条标注' });
      continue;
    }
    const entry = {};
    const title = validateTitle(rawValue.title, key, diagnostics);
    const types = validateTypes(rawValue.types, key, diagnostics);
    const level = validateLevel(rawValue.level, key, diagnostics);
    if (title !== null) entry.title = title;
    if (types !== null) entry.types = types;
    if (level !== null) entry.level = level;
    // 同一条路径出现多次时后者覆盖前者：JSON 里对象键唯一，真正重复只可能来自规范化碰撞。
    videos.set(key, entry);

    // 同一份标注再建一份「部署态」索引：键含 `／` 的那 11 条在部署目录里是
    // `~ff0f~` 形态，不建这份索引就整条标注落空（标题漏机器噪音、难度退回待标注）。
    // 规则见 ids.mjs 里 escapeRelativePath 的映射表注释，与 scripts/vid-paths.mjs 对拍。
    const targetKey = escapeRelativePath(key);
    if (targetKey.length === 0) continue;
    const existing = videosByTarget.get(targetKey);
    if (existing !== undefined && existing.sourceKey !== key) {
      // 两个不同的源文件转义后撞成同一个键：只有一条能真正对上文件，不能静默覆盖。
      // 记一条 metadata 诊断（diagnostics 会原样发给浏览器，所以只写相对路径）。
      diagnostics.push({
        path: targetKey,
        kind: 'metadata',
        message: `标注键 ${JSON.stringify(existing.sourceKey)} 与 ${JSON.stringify(key)} 转义后是同一个路径，部署目录里只能用上其中一条`,
      });
    }
    videosByTarget.set(targetKey, { sourceKey: key, entry });
  }

  const rawDefaults =
    typeof data.defaultTypes === 'object' && data.defaultTypes !== null && !Array.isArray(data.defaultTypes)
      ? data.defaultTypes
      : {};
  for (const [rawDir, rawValue] of Object.entries(rawDefaults)) {
    const dir = normalizeRelativePath(rawDir);
    const types = validateTypes(rawValue, dir || label, diagnostics);
    if (types === null) continue;
    defaultTypes.set(dir, types);
    // 目录名同样会被 prepare 转义（实测 catalog/annotations.json 里 23 个目录键
    // 都不含 `／`，但规则是通用的：哪天出现含 `／` 的目录，兜底类型也不能丢）。
    const targetDir = escapeRelativeDirectory(dir);
    if (targetDir !== dir) defaultTypesByTarget.set(targetDir, types);
  }

  return { file, present: true, videos, defaultTypes, videosByTarget, defaultTypesByTarget, diagnostics };
}

/**
 * 查一条视频的标注。
 *
 * 三层，顺序有讲究：
 *   1. 部署态索引（`videosByTarget`）：VIDEO_ROOT 指向 prepare 产物时的主路径，
 *      键与扫描结果逐字节相同，最精确；
 *   2. 原始键（`videos`）：VIDEO_ROOT 直接指源目录（未转义）时的主路径，
 *      也是 prepare 之前的开发/夹具形态；
 *   3. 还原后回原始索引：第 1、2 层都没命中时，把部署态路径里的 `~hhhh~` 还原成
 *      原字符再试一次。这是**兜底**（用来扛住转义规则将来变动导致第 1 层的预计算键
 *      与实际文件名对不上的情况），不是主路径 —— 单靠它就退化成
 *      「见到 `~ff0f~` 就换 `／`」那种单向硬编码，规则一加就会静默失配。
 *
 * 传入的 relativePath 允许是任意形态；三层都没命中时返回 null（前端显示「待标注」）。
 */
export function findAnnotation(annotations, relativePath) {
  const rel = normalizeRelativePath(relativePath);
  if (rel.length === 0 || annotations === null || typeof annotations !== 'object') return null;

  const byTarget = annotations.videosByTarget;
  if (byTarget instanceof Map) {
    const hit = byTarget.get(rel);
    if (hit !== undefined) return hit.entry;
  }

  const byRaw = annotations.videos;
  if (byRaw instanceof Map) {
    const direct = byRaw.get(rel);
    if (direct !== undefined) return direct;
    const restored = unescapeRelativePath(rel);
    if (restored !== rel) {
      const loose = byRaw.get(restored);
      if (loose !== undefined) return loose;
    }
  }

  return null;
}

/**
 * 从文件名推导标题。
 * 顺序：标注 title > 去序号的文件名 > 所在目录名。
 *
 * **先还原转义再剥文件名**：部署目录里 `／`(U+FF0F) 已被 prepare 转义成 `~ff0f~`
 * （`scripts/vid-paths.mjs`，规则表见 ids.mjs 的注释）。转义只该影响**路径**，
 * 绝不该影响**显示文本** —— 否则没标注的视频标题会直接把 `~ff0f~` 这种机器噪音
 * 显示给用户。这层是纵深防御：即使标注命中（走 annotation.title）或某条标注缺失，
 * 都不该泄漏转义残留。
 *
 * 幂等性：对**同一个**部署态路径反复调用结果恒等（还原只作用于入参路径，
 * 不作用于输出标题）；`titleFromRelativePath(转义态) === titleFromRelativePath(原始态)`
 * 也成立 —— 这正是 tests/node/server.test.ts 锁住的性质。
 *
 * 去序号规则故意很保守：只削掉「零填充序号」（01/002/1.）或「后面紧跟分隔符的序号」。
 * 因为真实标题本身就可能以数字开头（`20 分钟晨起唤醒…`），
 * 宽松的 `^\d+\s*` 会把它削成 `分钟晨起唤醒…`，比不去还糟。
 */
export function titleFromRelativePath(relativePath) {
  const normalized = unescapeRelativePath(relativePath);
  const base = normalized.slice(normalized.lastIndexOf('/') + 1);
  const withoutExt = base.replace(/\.[^.]+$/, '');
  const withoutIndex = stripOrdinalPrefix(withoutExt);
  const dir = parentDirectory(normalized);
  const dirName = dir.length > 0 ? dir.slice(dir.lastIndexOf('/') + 1) : '';
  // 文件名剥掉序号后只剩一个裸数字（`01.mp4`），它当标题没有任何信息量，退回目录名。
  if (withoutIndex.length === 0 || /^\d+$/.test(withoutIndex)) {
    return dirName.length > 0 ? dirName : withoutExt;
  }
  return withoutIndex;
}

function stripOrdinalPrefix(value) {
  const zeroPadded = /^0\d{1,3}(?=\s|[.、_\-－—)）])/.exec(value);
  if (zeroPadded) return trimLeadingSeparator(value.slice(zeroPadded[0].length));
  const withSeparator = /^\d{1,3}[.、_\-－—)）]/.exec(value);
  if (withSeparator) return trimLeadingSeparator(value.slice(withSeparator[0].length));
  return value;
}

function trimLeadingSeparator(value) {
  return value.replace(/^\s*[.、_\-－—)）]?\s*/, '').trim();
}

/**
 * defaultTypes 兜底查找：从视频所在目录逐级向上找第一个有配置的目录，
 * 最后兜到根目录（键是空串）。只在视频自身没有合法 types 时使用。
 *
 * 两张表一起查，键的形态（原始态 / 部署态）因此无所谓：
 *   - `defaultTypes`：标注里的原始目录名（含 `／`）
 *   - `defaultTypesByTarget`：同一批目录名按 prepare 规则转义后的形态（`~ff0f~`）
 * 视频路径是部署态时靠第二张表命中，是源目录形态时靠第一张表命中。
 * 再兜一轮「把路径还原成原始态」是为了扛住将来目录名出现别的可转义字符的情况。
 *
 * 第二个参数省略时只查第一轮，行为与旧版完全一致（直接 new Map() 传进来的调用点不受影响）。
 */
export function resolveDefaultTypes(defaultTypes, relativePath, defaultTypesByTarget) {
  const chainFor = (value) => {
    const dir = parentDirectory(value);
    return [dir, ...ancestorDirectories(dir), ''];
  };
  const lookup = (candidate) => {
    const raw = defaultTypes.get(candidate);
    if (raw && raw.length > 0) return raw;
    if (defaultTypesByTarget instanceof Map) {
      const target = defaultTypesByTarget.get(candidate);
      if (target && target.length > 0) return target;
    }
    return null;
  };

  for (const candidate of chainFor(relativePath)) {
    const types = lookup(candidate);
    if (types !== null) return types;
  }

  const restored = unescapeRelativePath(relativePath);
  if (restored !== normalizeRelativePath(relativePath)) {
    for (const candidate of chainFor(restored)) {
      const types = lookup(candidate);
      if (types !== null) return types;
    }
  }

  return [];
}

/** 代码 / 错误信息归一，给诊断消息用。 */
function code(error) {
  if (error && typeof error === 'object' && 'code' in error && error.code) return String(error.code);
  return message(error);
}

function message(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
