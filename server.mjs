/**
 * P038 家庭运动视频库 —— 局域网 HTTP 后端。
 *
 * 设计约束（与任务书一致，改动前先确认没破坏）：
 *   - 零第三方依赖，只用 Node 内置模块。
 *   - 视频目录只读：代码里没有 write/unlink/rename 视频的路径。
 *   - 视频永远不整段读进内存：一律 createReadStream + Range。
 *   - 浏览器只拿 16 位 id 和相对路径，永远拿不到绝对路径。
 *   - 任何异常都变成 JSON 错误响应，进程不退出。
 *
 * 导出 createServer() 工厂，监听逻辑放在文件末尾的 main() 里，
 * 这样测试可以 import 后用 127.0.0.1:0 起临时实例，不需要抢真实端口。
 */

import http from 'node:http';
import { createReadStream, promises as fsp } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { checkVideoRoot, resolveConfig } from './server/config.mjs';
import { createCatalogService } from './server/catalog-service.mjs';
import { buildRangeResponse, contentTypeFor, parseRange } from './server/http-range.mjs';
import { sendJson, sendJsonHead } from './server/http-responses.mjs';
import { serveStatic } from './server/static-files.mjs';
import { findThumbnail } from './server/thumbnails.mjs';
import { isStillVideoPath } from './server/catalog-build.mjs';
import { isValidVideoId } from './server/ids.mjs';
import { mergeDurationsIntoCache, probeDurations } from './server/duration-probe.mjs';

const STREAM_ID_PATTERN = /^\/api\/videos\/([^/]+)\/stream$/;
const THUMBNAIL_ID_PATTERN = /^\/api\/videos\/([^/]+)\/thumbnail$/;

/**
 * 创建一个未监听的 HTTP 服务。
 * @param {{env?: NodeJS.ProcessEnv, overrides?: Partial<ReturnType<typeof resolveConfig>>}} [options]
 */
export function createServer(options = {}) {
  const config = { ...resolveConfig(options.env ?? process.env), ...(options.overrides ?? {}) };
  if (!config.catalogCacheFile) {
    config.catalogCacheFile = resolveConfig(options.env ?? process.env).catalogCacheFile;
  }
  const catalog = createCatalogService(config);

  const server = http.createServer((req, res) => {
    handleRequest(req, res, config, catalog).catch((error) => {
      // 兜底：任何漏出来的异常都不能让进程退出，也不能把连接挂死。
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal_error', message: describeError(error) });
      } else {
        res.destroy();
      }
    });
  });

  // 挂上去方便测试与内网诊断脚本直接读目录缓存。
  server.catalogService = catalog;
  server.config = config;
  return server;
}

async function handleRequest(req, res, config, catalog) {
  const method = req.method ?? 'GET';
  const pathname = safePathname(req.url);

  if (pathname === null) {
    sendJson(res, 400, { error: 'bad_request', message: '请求路径无法解码' });
    return;
  }

  if (pathname.startsWith('/api/')) {
    await handleApi(req, res, method, pathname, config, catalog);
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 405, { error: 'method_not_allowed', message: `不支持的方法：${method}` });
    return;
  }

  const handled = await serveStatic(req, res, { distDir: config.distDir });
  if (!handled) {
    sendJson(res, 404, { error: 'not_found', message: '页面不存在' });
  }
}

async function handleApi(req, res, method, pathname, config, catalog) {
  if (pathname === '/api/health') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { error: 'method_not_allowed', message: `/api/health 只支持 GET` });
      return;
    }
    await handleHealth(req, res, catalog);
    return;
  }

  if (pathname === '/api/videos') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { error: 'method_not_allowed', message: `/api/videos 只支持 GET` });
      return;
    }
    await handleVideos(req, res, catalog, false);
    return;
  }

  if (pathname === '/api/rescan') {
    if (method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed', message: '/api/rescan 只支持 POST' });
      return;
    }
    // 维护步骤：重新扫描目录，结构与 /api/videos 完全一致，前端可以直接复用同一个解析器。
    await handleVideos(req, res, catalog, true);
    scheduleDurationProbe(config, catalog);
    return;
  }

  const streamMatch = STREAM_ID_PATTERN.exec(pathname);
  if (streamMatch !== null) {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { error: 'method_not_allowed', message: '视频流只支持 GET / HEAD' });
      return;
    }
    await handleStream(req, res, catalog, streamMatch[1]);
    return;
  }

  const thumbnailMatch = THUMBNAIL_ID_PATTERN.exec(pathname);
  if (thumbnailMatch !== null) {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { error: 'method_not_allowed', message: '缩略图只支持 GET / HEAD' });
      return;
    }
    await handleThumbnail(req, res, catalog, config, thumbnailMatch[1]);
    return;
  }

  sendJson(res, 404, { error: 'not_found', message: `接口不存在：${pathname}` });
}

async function handleHealth(req, res, catalog) {
  try {
    const snapshot = await catalog.get();
    const videoCount = snapshot.videos.length;
    const problem = healthProblem(snapshot, videoCount);
    // ok 的含义是「服务活着，且视频目录真的能用」：目录整个消失 / 一个视频都没有时
    // 报 true，等于告诉运维「一切正常」，而用户那边只看到一片空白。
    // HTTP 状态码仍然是 200：Docker healthcheck 只看状态码，「服务活着但目录读不了」
    // 和「服务死了」必须能被区分开，所以用 ok + error 表达，而不是 5xx。
    const body = {
      ok: problem === null,
      videoCount,
      annotationCount: snapshot.annotationCount,
      diagnosticCount: snapshot.diagnostics.length,
      videoRootAvailable: snapshot.videoRootAvailable,
      generatedAt: snapshot.generatedAt,
      ...(problem === null ? {} : { error: problem }),
    };
    if (req.method === 'HEAD') sendJsonHead(res, 200, body);
    else sendJson(res, 200, body);
  } catch (error) {
    // 契约：扫描失败时 ok:false + error，而不是 5xx。
    // Docker healthcheck 只看 HTTP 状态码，500 会让容器一直 unhealthy，
    // 但「服务活着、视频目录读不了」和「服务死了」是完全不同的两件事。
    sendJson(res, 200, {
      ok: false,
      videoCount: 0,
      annotationCount: 0,
      diagnosticCount: 0,
      videoRootAvailable: false,
      generatedAt: new Date().toISOString(),
      error: describeError(error),
    });
  }
}

/** health 的失败原因：区分「目录不存在/读不了」和「目录是空的」。正常时返回 null。 */
function healthProblem(snapshot, videoCount) {
  if (snapshot.videoRootAvailable === false) {
    return '视频根目录不存在或读不了，请检查 Mac 上的视频目录挂载配置（服务已启动，但没有可读的目录）';
  }
  if (videoCount === 0) {
    return '视频根目录里一个视频文件都没有，请确认视频已经转存到该目录';
  }
  return null;
}

async function handleVideos(req, res, catalog, force) {
  try {
    const snapshot = await catalog.get({ force });
    const body = {
      videos: snapshot.videos,
      diagnostics: snapshot.diagnostics,
      generatedAt: snapshot.generatedAt,
    };
    if (req.method === 'HEAD') sendJsonHead(res, 200, body);
    else sendJson(res, 200, body);
  } catch (error) {
    sendJson(res, 500, { error: 'scan_failed', message: describeError(error) });
  }
}

async function handleStream(req, res, catalog, rawId) {
  const found = await resolveVideo(catalog, rawId);
  if (found === null) {
    sendJson(res, 404, { error: 'video_not_found', message: '视频不存在或 id 非法' });
    return;
  }
  const { video, snapshot } = found;
  // 目录是只读挂载，但文件仍可能在扫描之后被换掉，所以请求时再 stat 一次。
  if (!isStillVideoPath(video.relativePath)) {
    sendJson(res, 404, { error: 'video_not_found', message: '视频已不存在' });
    return;
  }
  const absolutePath = absolutePathFor(snapshot, video);
  if (absolutePath === null) {
    sendJson(res, 404, { error: 'video_not_found', message: '视频已不存在' });
    return;
  }
  const stat = await fsp.stat(absolutePath).catch(() => null);
  if (stat === null || !stat.isFile() || stat.size === 0) {
    catalog.recordDiagnostic({
      path: video.relativePath,
      kind: 'missing',
      message: '播放时文件已消失或变成空文件',
    });
    sendJson(res, 404, { error: 'video_not_found', message: '视频文件不可用' });
    return;
  }

  const size = stat.size;
  const range = parseRange(req.headers.range, size);
  const mediaType = contentTypeFor(video.relativePath);
  const { status, headers } = buildRangeResponse(range, size, mediaType);

  if (status === 416) {
    const payload = Buffer.from(
      JSON.stringify({ error: 'range_not_satisfiable', message: `请求的范围超出文件大小（${size} 字节）` }),
      'utf8',
    );
    res.writeHead(416, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(payload.byteLength) });
    res.end(req.method === 'HEAD' ? undefined : payload);
    return;
  }

  res.writeHead(status, headers);
  // HEAD：头必须和对应 GET 完全一致，但没有 body。
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const start = range.type === 'range' ? range.start : 0;
  const end = range.type === 'range' ? range.end : size - 1;
  const stream = createReadStream(absolutePath, { start, end });

  stream.on('error', (error) => {
    // 文件在流的过程中被删 / 截断：头已经发出去了，只能断开。
    // 绝不能让这个 error 冒泡成未捕获异常把进程带走。
    catalog.recordDiagnostic({
      path: video.relativePath,
      kind: 'unreadable',
      message: `播放中断：${describeError(error)}`,
    });
    res.destroy();
  });

  // 客户端中途退出（切页面、拉进度条放弃）时立刻 destroy，
  // 否则文件描述符会一直挂到读完为止，长视频能把进程的文件句柄耗光。
  res.on('close', () => {
    if (!res.writableEnded) stream.destroy();
  });

  stream.pipe(res);
}

async function handleThumbnail(req, res, catalog, config, rawId) {
  const found = await resolveVideo(catalog, rawId);
  if (found === null) {
    sendJson(res, 404, { error: 'video_not_found', message: '视频不存在或 id 非法' });
    return;
  }
  const thumbnail = await findThumbnail(found.video.relativePath, config.thumbnailDir);
  if (thumbnail === null) {
    sendJson(res, 404, { error: 'thumbnail_not_found', message: '这个视频还没有缩略图' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': thumbnail.type,
    'Content-Length': String(thumbnail.size),
    'Cache-Control': 'public, max-age=86400',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(thumbnail.path);
  stream.on('error', () => res.destroy());
  res.on('close', () => {
    if (!res.writableEnded) stream.destroy();
  });
  stream.pipe(res);
}

/**
 * id -> 目录条目。
 * 严格用 16 位小写十六进制校验：`..`、`/etc/passwd`、`%2e%2e%2f` 之类
 * 在解码后立刻就被判非法，天然不可能走到「拼路径」那一步。
 */
async function resolveVideo(catalog, rawId) {
  let id;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return null;
  }
  if (!isValidVideoId(id)) return null;
  const snapshot = await catalog.get();
  const video = snapshot.byId.get(id);
  if (video === undefined) return null;
  return { video, snapshot };
}

/** 从扫描缓存里取绝对路径。不经过任何客户端输入，所以这里只查表不拼字符串。 */
function absolutePathFor(snapshot, video) {
  const record = snapshot.records.get(video.id);
  return record === undefined ? null : record.absolutePath;
}

/**
 * 后台补时长缓存。进程内只会同时跑一个（probeDurations 自己有 in-flight 保护）。
 * 无论成功失败都不影响请求：这是一个「锦上添花」的优化，不是必需路径。
 */
function scheduleDurationProbe(config, catalog) {
  const snapshot = catalog.peek();
  if (snapshot === null) return;
  const missing = snapshot.videos
    .filter((video) => video.durationSeconds <= 0)
    .map((video) => {
      const record = snapshot.records.get(video.id);
      return record === undefined ? null : { relativePath: record.relativePath, absolutePath: record.absolutePath };
    })
    .filter((item) => item !== null);
  if (missing.length === 0) return;

  void probeDurations(missing)
    .then(async (found) => {
      if (found.size === 0) return;
      catalog.notifyDurations(found);
      await mergeDurationsIntoCache(config.catalogCacheFile, found);
    })
    .catch(() => {
      /* 后台任务失败静默：请求路径上已经有可用的兜底行为。 */
    });
}

function safePathname(url) {
  const raw = (url ?? '/').split('?')[0].split('#')[0];
  if (raw.includes('\0')) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function describeError(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return '未知错误';
}

/* ---------------------------------- 启动 ---------------------------------- */

async function main() {
  const config = resolveConfig(process.env);

  const check = await checkVideoRoot(config.videoRoot);
  if (!check.ok) {
    process.stderr.write(`[fitness-videos] 启动失败：${check.error}\n`);
    process.exitCode = 1;
    return;
  }

  const server = createServer({ overrides: config });
  const catalog = server.catalogService;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  }).catch((error) => {
    process.stderr.write(`[fitness-videos] 监听 ${config.host}:${config.port} 失败：${describeError(error)}\n`);
    process.exitCode = 1;
    return;
  });

  const address = server.address();
  const shownPort = address && typeof address === 'object' ? address.port : config.port;
  process.stdout.write(
    `[fitness-videos] 已启动 http://${config.host}:${shownPort}（视频目录 ${config.videoRoot}）\n`,
  );

  // 预热一次目录，让第一个打开页面的人不用等扫描；失败也无所谓，等第一次请求再试。
  catalog.get().catch(() => {}).finally(() => scheduleDurationProbe(config, catalog));

  const shutdown = (signal) => {
    process.stdout.write(`[fitness-videos] 收到 ${signal}，正在关闭…\n`);
    server.close(() => process.exit(0));
    // 兜底：10 秒还没关完（比如有卡住的长连接）就强制退出。
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`[fitness-videos] 未捕获异常：${describeError(error)}\n`);
    process.exitCode = 1;
  });
}
