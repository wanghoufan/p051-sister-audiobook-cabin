/**
 * 时长缓存：读 `catalog-cache.json`（与标注文件同目录），形如
 *   { "<relativePath>": { "durationSeconds": 12.3 } }
 *
 * 为什么不现场调 ffprobe：一次探针要几十到几百毫秒，131 个视频就是几十秒。
 * 放进 HTTP 请求里会让 /api/videos 变成一个「点一下等半分钟」的页面。
 * 所以请求路径上只读缓存；缓存缺项由后台任务（见 duration-probe.mjs）慢慢补。
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { normalizeRelativePath } from './ids.mjs';

export const CACHE_FILENAME = 'catalog-cache.json';

/** 标注文件同级目录里的缓存文件路径。 */
export function resolveCacheFile(annotationsFile) {
  return path.join(path.dirname(path.resolve(annotationsFile)), CACHE_FILENAME);
}

/**
 * 读取并索引时长缓存。键统一规范化，避免 JSON 里写成 `./a/b.mp4` 就查不到。
 * @returns {Promise<{file:string,present:boolean,map:Map<string,number>,diagnostics:object[]}>}
 */
export async function loadDurationCache(file) {
  const empty = { file, present: false, map: new Map(), diagnostics: [] };

  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return empty;
    return {
      ...empty,
      diagnostics: [{ path: path.basename(file), kind: 'metadata', message: `无法读取时长缓存：${codeOf(error)}` }],
    };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return {
      ...empty,
      present: true,
      diagnostics: [
        { path: path.basename(file), kind: 'metadata', message: `时长缓存不是合法 JSON：${messageOf(error)}` },
      ],
    };
  }

  const map = new Map();
  const diagnostics = [];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    diagnostics.push({ path: path.basename(file), kind: 'metadata', message: '时长缓存顶层应该是对象，已按空缓存处理' });
    return { file, present: true, map, diagnostics };
  }

  for (const [rawKey, rawValue] of Object.entries(data)) {
    const key = normalizeRelativePath(rawKey);
    if (key.length === 0) continue;
    const seconds =
      typeof rawValue === 'number'
        ? rawValue
        : typeof rawValue === 'object' && rawValue !== null
          ? rawValue.durationSeconds
          : undefined;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
      diagnostics.push({
        path: key,
        kind: 'metadata',
        message: '时长缓存条目里的 durationSeconds 不是非负有限数，已忽略',
      });
      continue;
    }
    map.set(key, seconds);
  }

  return { file, present: true, map, diagnostics };
}

function codeOf(error) {
  if (error && typeof error === 'object' && 'code' in error && error.code) return String(error.code);
  return messageOf(error);
}

function messageOf(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
