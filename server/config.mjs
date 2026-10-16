/**
 * 配置解析。契约里的环境变量全部在这里读，其它模块不再碰 process.env。
 *
 * 路径一律在加载时 resolve 成绝对路径：服务启动后再改 cwd 的话，
 * 相对路径的含义会漂移，跑着跑着就找不到视频目录了。
 */

import path from 'node:path';
import { resolveCacheFile } from './duration-cache.mjs';

export const DEFAULTS = Object.freeze({
  VIDEO_ROOT: '/videos',
  ANNOTATIONS_FILE: './catalog/annotations.json',
  THUMBNAIL_DIR: './catalog/thumbnails',
  APP_PORT: 8787,
  DIST_DIR: './dist',
  HOST: '0.0.0.0',
});

export function resolveConfig(env = process.env) {
  const annotationsFile = path.resolve(env.ANNOTATIONS_FILE || DEFAULTS.ANNOTATIONS_FILE);
  return {
    videoRoot: path.resolve(env.VIDEO_ROOT || DEFAULTS.VIDEO_ROOT),
    annotationsFile,
    thumbnailDir: path.resolve(env.THUMBNAIL_DIR || DEFAULTS.THUMBNAIL_DIR),
    catalogCacheFile: resolveCacheFile(annotationsFile),
    distDir: path.resolve(env.DIST_DIR || DEFAULTS.DIST_DIR),
    port: toPort(env.APP_PORT, DEFAULTS.APP_PORT),
    host: env.HOST || DEFAULTS.HOST,
  };
}

function toPort(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65535) return fallback;
  return value;
}

/**
 * 启动前的目录体检。
 * VIDEO_ROOT 不存在必须直接失败：悄悄建个空目录的话，服务会「正常」返回 0 个视频，
 * 用户看到空页面却查不出原因。宁可起不来并说清楚。
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function checkVideoRoot(videoRoot) {
  const { promises: fsp } = await import('node:fs');
  try {
    const stat = await fsp.stat(videoRoot);
    if (!stat.isDirectory()) {
      return { ok: false, error: `VIDEO_ROOT 不是目录：${videoRoot}` };
    }
    return { ok: true };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : 'UNKNOWN';
    if (code === 'ENOENT') {
      return { ok: false, error: `VIDEO_ROOT 不存在：${videoRoot}\n请把视频目录挂载/指向这个路径后重启服务。` };
    }
    if (code === 'EACCES') {
      return { ok: false, error: `VIDEO_ROOT 没有读取权限：${videoRoot}` };
    }
    return { ok: false, error: `VIDEO_ROOT 无法访问（${code}）：${videoRoot}` };
  }
}
