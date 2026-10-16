/**
 * 静态前端托管。
 *
 * 两个必须做对的地方：
 *   1. 路径穿越：URL 解码后先 normalize 再 resolve，最后前缀校验，`.` 开头的一律不服务。
 *   2. SPA 回退：`/api/*` 绝不能被静态拦截（否则 404 会返回 index.html 的 HTML，
 *      前端 fetch().json() 会报「返回的不是 JSON」这种完全误导人的错）。
 *      所以只有「不带扩展名」的路径才回退到 index.html。
 */

import { createReadStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import { sendJson } from './http-responses.mjs';

const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
});

export function contentTypeForPath(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

const NOT_BUILT_HTML = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>前端未构建</title></head>
<body style="font-family: system-ui, sans-serif; margin: 3rem auto; max-width: 40rem; line-height: 1.7">
<h1>前端未构建</h1>
<p>后端服务已启动，但 <code>dist/</code> 目录不存在，页面还没有打包出来。</p>
<p>请先在项目目录执行：</p>
<pre style="background:#f4f4f5;padding:1rem;border-radius:.5rem">pnpm build</pre>
<p>构建完成后刷新本页即可。诊断用的接口仍然可用：<a href="/api/health">/api/health</a>、<a href="/api/videos">/api/videos</a>。</p>
</body>
</html>
`;

/**
 * @returns {Promise<boolean>} 是否已经处理了这次请求
 */
export async function serveStatic(req, res, { distDir }) {
  const pathname = decodePathname(req.url);
  if (pathname === null) {
    sendJson(res, 400, { error: 'bad_request', message: '请求路径无法解码' });
    return true;
  }

  const distResolved = path.resolve(distDir);
  const exists = await fsp
    .stat(distResolved)
    .then((stat) => stat.isDirectory())
    .catch(() => false);

  if (!exists) {
    if (pathname === '/') {
      const body = Buffer.from(NOT_BUILT_HTML, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return true;
    }
    return false;
  }

  const target = resolveWithin(distResolved, pathname);
  if (target === null) {
    sendJson(res, 404, { error: 'not_found', message: '页面不存在' });
    return true;
  }

  const stat = await fsp.stat(target).catch(() => null);
  const looksLikeAsset = path.extname(pathname) !== '';
  if (stat === null || !stat.isFile()) {
    // 带扩展名的请求说明是在找真实资源，没有就老实 404；
    // 不带扩展名的是前端路由（/video/:id 之类），回退到 index.html 交给前端路由。
    if (looksLikeAsset) return false;
    return sendIndexHtml(req, res, distResolved);
  }

  const headers = {
    'Content-Type': contentTypeForPath(target),
    'Content-Length': String(stat.size),
    'Last-Modified': stat.mtime.toUTCString(),
    // 带内容哈希的产物可以长缓存；index.html 不缓存，否则发版后用户拿不到新版本。
    'Cache-Control': looksLikeAsset ? 'public, max-age=3600' : 'no-cache',
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  pipeFile(req, res, target);
  return true;
}

async function sendIndexHtml(req, res, distResolved) {
  const indexPath = path.join(distResolved, 'index.html');
  const stat = await fsp.stat(indexPath).catch(() => null);
  if (stat === null || !stat.isFile()) {
    sendJson(res, 404, { error: 'not_found', message: '页面不存在' });
    return true;
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': String(stat.size),
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  pipeFile(req, res, indexPath);
  return true;
}

function pipeFile(req, res, filePath) {
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    // 头已经发出去了，没法再改状态码，只能断开让浏览器自己重试。
    res.destroy();
  });
  res.on('close', () => {
    if (!res.writableEnded) stream.destroy();
  });
  stream.pipe(res);
}

function decodePathname(url) {
  const raw = (url ?? '/').split('?')[0].split('#')[0];
  if (raw.includes('\0')) return null;
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.includes('\0') ? null : decoded;
  } catch {
    return null;
  }
}

/** 把 URL 路径解析成 dist 内的绝对路径；越界返回 null。 */
function resolveWithin(distResolved, pathname) {
  if (!pathname.startsWith('/')) return null;
  // 先看原始分段再 normalize：path.posix.normalize 会把根之上的 `..` 直接吃掉，
  // `/../../etc/passwd` 会被规整成 `/etc/passwd` 从而混进 SPA 回退。
  // 宁可明确拒绝：含 `..` 分段的请求一律 404。
  if (pathname.split('/').includes('..')) return null;
  const normalized = path.posix.normalize(pathname);
  if (normalized.includes('..')) return null;
  const relative = normalized.replace(/^\/+/, '');
  if (relative.length === 0) return path.join(distResolved, 'index.html');
  const target = path.resolve(distResolved, relative);
  const prefix = distResolved.endsWith(path.sep) ? distResolved : distResolved + path.sep;
  if (!target.startsWith(prefix)) return null;
  // 不服务隐藏文件（.env、.git 之类），即使它们真的在 dist 里。
  if (path.basename(target).startsWith('.')) return null;
  return target;
}
