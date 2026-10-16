/**
 * 统一的响应工具。
 *
 * 所有 API 错误都必须是 JSON `{ error: code, message }`：
 * 错误页返回 HTML 会让前端的 `response.json()` 抛出「Unexpected token <」，
 * 把一个后端 500 伪装成网络故障，是最难查的一类问题。
 */

export function sendJson(res, status, body) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.byteLength),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export function sendJsonHead(res, status, body) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.byteLength),
    'Cache-Control': 'no-store',
  });
  res.end();
}
