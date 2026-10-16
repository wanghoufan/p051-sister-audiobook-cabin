/**
 * HTTP Range 解析。
 *
 * 这是整个服务最关键的一段：视频播放器（Safari 尤其）完全依赖 206 + Content-Range
 * 才能拖进度条，Chrome/Android WebView 也会在 seek 时发 Range。
 * 一旦这里算错，表现是「能播但拖不动」或者「播到一半失败」，而且前端完全看不出原因。
 *
 * 返回四类结果：
 *   full          没有 Range 头（或不是 bytes 单位）→ 200 整段
 *   multi         多个范围（`bytes=0-99,200-299`）→ 200 整段
 *   range         206，附带 start/end（闭区间）
 *   unsatisfiable 非法 / 越界 → 416 + `Content-Range: bytes * /size`
 *
 * 关于 multi 的取舍：RFC 7233 允许对多范围请求回 multipart/byteranges。
 * 实际播放器（Chrome / Safari / Edge / Android ExoPlayer）从不发多范围请求，
 * 而 multipart 拼接要自己处理每个子段的头尾分隔，出错时排障成本很高。
 * 所以这里直接降级成 200 整段：浪费一点带宽，但绝对能播，且行为可预测。
 */

import path from 'node:path';

export const RANGE_FULL = Object.freeze({ type: 'full' });
export const RANGE_MULTI = Object.freeze({ type: 'multi' });
export const RANGE_UNSATISFIABLE = Object.freeze({ type: 'unsatisfiable' });

const MEDIA_TYPES = Object.freeze({
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
});

/** 按扩展名给媒体类型。未知扩展名退回 octet-stream，而不是瞎报 video/mp4。 */
export function contentTypeFor(fileName) {
  if (typeof fileName !== 'string') return 'application/octet-stream';
  return MEDIA_TYPES[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * 解析 Range 头。
 * @param {string|undefined|null} header
 * @param {number} size 完整文件字节数
 */
export function parseRange(header, size) {
  if (typeof header !== 'string' || header.trim().length === 0) return RANGE_FULL;
  const match = /^bytes=(.*)$/i.exec(header.trim());
  if (match === null) {
    // 非 bytes 单位：任务书要求非法 Range 一律 416（`abc` 也走这里）。
    return RANGE_UNSATISFIABLE;
  }
  const specs = match[1].split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (specs.length === 0) return RANGE_UNSATISFIABLE;
  if (specs.length > 1) return RANGE_MULTI;

  const spec = /^(\d*)-(\d*)$/.exec(specs[0]);
  if (spec === null) return RANGE_UNSATISFIABLE;
  const [, rawStart, rawEnd] = spec;

  if (!Number.isSafeInteger(size) || size <= 0) return RANGE_UNSATISFIABLE;

  if (rawStart.length === 0) {
    // 后缀式 bytes=-N：取末尾 N 字节。
    if (rawEnd.length === 0) return RANGE_UNSATISFIABLE;
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return RANGE_UNSATISFIABLE;
    const start = Math.max(0, size - suffixLength);
    return { type: 'range', start, end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) return RANGE_UNSATISFIABLE;

  if (rawEnd.length === 0) return { type: 'range', start, end: size - 1 };

  const requestedEnd = Number(rawEnd);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < 0) return RANGE_UNSATISFIABLE;
  if (requestedEnd < start) return RANGE_UNSATISFIABLE; // bytes=5-2
  return { type: 'range', start, end: Math.min(requestedEnd, size - 1) };
}

/**
 * 算出响应头。
 * @returns {{ status: number, headers: Record<string,string> }}
 */
export function buildRangeResponse(range, size, mediaType) {
  if (range.type === 'unsatisfiable') {
    return {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
    };
  }
  const base = {
    'Content-Type': mediaType,
    'Accept-Ranges': 'bytes',
    // 视频是不可变资源（id 由路径哈希决定，改名才会变），但离线部署里
    // 反复重扫目录很常见，所以仍走 no-cache 让浏览器每次问一遍服务器。
    'Cache-Control': 'no-cache',
  };
  if (range.type === 'range') {
    const length = range.end - range.start + 1;
    return {
      status: 206,
      headers: {
        ...base,
        'Content-Length': String(length),
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      },
    };
  }
  return { status: 200, headers: { ...base, 'Content-Length': String(size) } };
}
