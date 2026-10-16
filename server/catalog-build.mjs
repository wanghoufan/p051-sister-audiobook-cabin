/**
 * Video 对象合成。
 *
 * 这里是唯一决定「一条视频对外长什么样」的地方，字段名与 src/lib/types.ts 的
 * `Video` / `CatalogDiagnostic` 严格一一对应；改了这里必须同步改那边。
 */

import { isVideoFileName } from './catalog-scan.mjs';
import { findAnnotation, resolveDefaultTypes, titleFromRelativePath } from './annotations.mjs';
import { findThumbnail, thumbnailUrlFor } from './thumbnails.mjs';
import { MISSING_DURATION_MESSAGE, summarizeMissingDurations } from './duration-probe.mjs';

/**
 * @param {object} input
 * @param {{videos: object[], diagnostics: object[]}} input.scanned
 * @param {{videos: Map<string,object>, defaultTypes: Map<string,string[]>, videosByTarget?: Map<string,object>, defaultTypesByTarget?: Map<string,string[]>}} input.annotations
 * @param {{map: Map<string,number>, file?: string}} input.durations
 * @param {string} input.thumbnailDir
 */
export async function buildVideoList({ scanned, annotations, durations, thumbnailDir }) {
  const videos = [];
  const diagnostics = [];
  const missingDurationPaths = [];

  for (const record of scanned.videos) {
    const rel = record.relativePath;
    // 走 findAnnotation 而不是 annotations.videos.get(rel)：扫描到的 rel 可能是
    // prepare 转义后的部署态路径（`~ff0f~`），而标注键是源目录原名（`／`）。
    // 直接 get 会让这 11 条整条标注落空 —— 标题漏机器噪音、难度退回「待标注」。
    const annotation = findAnnotation(annotations, rel);
    const types = annotation && Array.isArray(annotation.types) && annotation.types.length > 0
      ? annotation.types
      : resolveDefaultTypes(annotations.defaultTypes, rel, annotations.defaultTypesByTarget);

    const title =
      annotation && typeof annotation.title === 'string' && annotation.title.length > 0
        ? annotation.title
        : titleFromRelativePath(rel);

    const durationSeconds = durations.map.get(rel) ?? 0;
    if (durationSeconds <= 0) {
      // 缓存缺时长 → 明确标成不可播放，而不是让用户点进去听半天没声音才发现。
      // 逐条诊断在循环结束后统一收敛：130 条一模一样的噪音等于没有线索。
      missingDurationPaths.push(rel);
    }

    const thumbnail = await findThumbnail(rel, thumbnailDir);
    const available = record.size > 0 && durationSeconds > 0;

    videos.push({
      id: record.id,
      relativePath: rel,
      title,
      durationSeconds,
      types,
      // 等级只来自标注里的 level 字段（封面原图上印的 K1–K5）。
      // 没标就是 null，**绝不从类型标签或文件名推导** —— 唯一能定的来源是封面。
      // level: annotations.mjs 的 validateLevel 已经过滤过非法值，这里只判存在性。
      level: annotation && typeof annotation.level === 'string' ? annotation.level : null,
      hasThumbnail: thumbnail !== null,
      // URL 形态由 server/thumbnails.mjs 的 thumbnailUrlFor 唯一决定（带 ?v= 版本号），
      // 不要在这里手拼：缩略图是「原地覆盖」更新的，而 URL 稳定 + max-age=86400
      // 会让浏览器继续用旧图 24 小时。详见 thumbnails.mjs 的 thumbnailVersion 注释。
      thumbnailUrl: thumbnail === null ? null : thumbnailUrlFor(record.id, thumbnail.version),
      playbackUrl: `/api/videos/${encodeURIComponent(record.id)}/stream`,
      available,
    });
  }

  diagnostics.push(...missingDurationDiagnostics(missingDurationPaths, durations.file));

  return { videos, diagnostics };
}

/**
 * 把「哪些视频没时长」变成 diagnostics。
 *
 * - 0 个：什么都不加。
 * - 1 个：留一条**带具体路径**的诊断 —— 只缺一条时，路径本身就是全部信息，收敛反而丢线索。
 * - N 个（>1）：交给 summarizeMissingDurations 收敛成 1 条汇总，写明数量、影响和修复命令。
 */
function missingDurationDiagnostics(paths, cacheFile) {
  if (paths.length === 0) return [];
  if (paths.length === 1) {
    // 单条时也带上修复命令：只缺一条往往正是「缓存文件没生成/被删了」的早期信号，
    // 光说「这一条没有」维护者仍然不知道该做什么。
    return [{ path: paths[0], kind: 'metadata', message: `${MISSING_DURATION_MESSAGE}。请在宿主机运行 node scripts/prepare-videos.mjs cache --videos <播放目录> --out <标注目录> 重新生成时长缓存` }];
  }
  const perItem = paths.map((rel) => ({ path: rel, kind: 'metadata', message: MISSING_DURATION_MESSAGE }));
  return summarizeMissingDurations(perItem, { cacheFile });
}

/**
 * 重新校验「某个相对路径此刻是否仍是一个合法的视频文件」。
 * 供流播前的二次防御使用：扫描结果可能已经过时（文件被删、被换成目录、被换成非视频名）。
 */
export function isStillVideoPath(relativePath) {
  const base = relativePath.slice(relativePath.lastIndexOf('/') + 1);
  return isVideoFileName(base);
}
