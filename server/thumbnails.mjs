/**
 * 缩略图定位与版本化。
 *
 * 规则与 scripts/vid-paths.mjs 的 `thumbRelativePath` 对齐：
 * 播放目录是源目录的「清洗镜像」，缩略图与视频同构、只换扩展名。
 * 服务端按同一规则反推，这样 macOS 开发直连源目录、容器内挂载镜像目录
 * 两种部署都能命中。
 *
 * 之所以自己实现而不 import scripts/：那是另一个 agent 的文件，
 * 服务端必须能在 scripts 目录被改动后仍按自己的契约工作。
 *
 * **本模块同时是缩略图 URL 的唯一出处**（thumbnailUrlFor）。改 URL 形态
 * （加 ?v= 之类）只改这里，不要在调用点手拼字符串 —— 那正是缓存失效的来源。
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { splitExtension } from './catalog-scan.mjs';

/** 版本号长度。8 位十六进制足够区分「这次部署」和「上次部署」，又不至于把 URL 撑长。 */
export const VERSION_LENGTH = 8;

const THUMBNAIL_EXTENSIONS = Object.freeze([
  { ext: '.jpg', type: 'image/jpeg' },
  { ext: '.jpeg', type: 'image/jpeg' },
  { ext: '.webp', type: 'image/webp' },
  { ext: '.png', type: 'image/png' },
]);

/**
 * 候选路径：先按同构全路径试（生产布局），再退到扁平文件名（手工放的缩略图）。
 */
export function thumbnailCandidates(relativePath, thumbnailDir) {
  const normalizedDir = path.resolve(thumbnailDir);
  const withoutExt = relativePath.replace(/\.[^.]+$/, '');
  const base = withoutExt.slice(withoutExt.lastIndexOf('/') + 1);
  const dirOf = withoutExt.includes('/') ? withoutExt.slice(0, withoutExt.lastIndexOf('/')) : '';

  const candidates = [];
  for (const { ext } of THUMBNAIL_EXTENSIONS) {
    candidates.push(path.join(normalizedDir, `${withoutExt}${ext}`));
    if (dirOf.length > 0) candidates.push(path.join(normalizedDir, dirOf, `${base}${ext}`));
    candidates.push(path.join(normalizedDir, `${base}${ext}`));
  }
  return candidates;
}

/**
 * 缩略图的「内容版本」。
 *
 * 为什么需要：缩略图 URL 是稳定的 `/api/videos/{id}/thumbnail`，而响应头带
 * `Cache-Control: public, max-age=86400`。一旦把封面**原地覆盖**成新尺寸
 * （比如从 480×640 降到 240×320 来治白屏），浏览器里那份旧图还会被继续使用
 * 24 小时 —— 用户看到的仍是旧图，而且**旧图正是导致渲染进程被 OOM 杀的那个尺寸**。
 * 功能改对了，用户却一天之内仍然白屏，且没有任何办法自己察觉。
 *
 * 做法：把「size + mtime」压成一个短 token 挂到 URL 的 `?v=` 上。
 * 封面一旦被重写，mtime 变 → token 变 → URL 变成浏览器从未请求过的地址
 * → 必然回源。老用户只要刷新页面就能立刻看到新封面，不需要清缓存、不需要等过期。
 *
 * 为什么不用 ETag / `no-cache`：
 *   - 服务端在 `server.mjs` 里写死了 Cache-Control，而改那行的成本远高于加一个查询串；
 *   - `no-cache` 语义下浏览器每次都要发条件请求，266 张卡片就是 266 次往返，
 *     在渲染进程已经濒临 OOM 的设备上这是不必要的额外压力；
 *   - 版本化 URL 顺带让「同一张图反复出现」也能被浏览器长期缓存。
 *
 * 为什么不用内容哈希（真读一遍文件算 sha）：每次列目录都要把 266 张图全读一遍，
 * 慢且毫无必要；mtime + size 在「原子 rename 覆盖」的写入方式下已经足够
 * （prepare-videos 的 thumbnail / covers 子命令都是先写 .part 再 rename）。
 */
export function thumbnailVersion(stat) {
  // 混进 relativePath：两个不同视频的缩略图即使 size/mtime 相同也不该共享版本号。
  // 取整到秒：ext4/APFS 的 mtime 精度是 1ns，同一秒内的两次重写概率极低，
  // 而秒级让这个值在同一次服务周期内保持稳定，不会让 URL 每次请求都变。
  return createHash('sha1')
    .update(`${stat.size}:${Math.floor(stat.mtimeMs)}`)
    .digest('hex')
    .slice(0, VERSION_LENGTH);
}

/**
 * 带版本号的缩略图 URL。
 *
 * 查询串对路由完全透明：`server.mjs` 的 `safePathname()` 会 `split('?')[0]`
 * 把查询串剥掉再匹配 `/api/videos/{id}/thumbnail`，所以**服务端路由一行都不用改**。
 */
export function thumbnailUrlFor(id, version) {
  const base = `/api/videos/${encodeURIComponent(id)}/thumbnail`;
  return version === null || version === undefined || version === ''
    ? base
    : `${base}?v=${encodeURIComponent(version)}`;
}

/**
 * 找第一个真实存在的缩略图。返回 null 表示没有（前端就显示占位块，不发请求）。
 * 目录不存在时直接返回 null：服务必须能在完全没有缩略图的情况下正常跑。
 */
export async function findThumbnail(relativePath, thumbnailDir) {
  const dir = path.resolve(thumbnailDir);
  const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
  for (const candidate of thumbnailCandidates(relativePath, dir)) {
    const resolved = path.resolve(candidate);
    // 候选路径都由我们自己拼，但仍然校验一次：宁可少一张图，也不要读目录外的文件。
    if (resolved !== dir && !resolved.startsWith(prefix)) continue;
    const found = THUMBNAIL_EXTENSIONS.find((item) => item.ext === path.extname(resolved).toLowerCase());
    const stat = await fsp.stat(resolved).catch(() => null);
    if (stat === null || !stat.isFile() || stat.size === 0) continue;
    return {
      path: resolved,
      type: found ? found.type : 'application/octet-stream',
      size: stat.size,
      // 供 thumbnailUrlFor 生成带 ?v= 的 URL，让封面更新能立刻穿透浏览器缓存
      version: thumbnailVersion(stat),
    };
  }
  return null;
}

/** 视频 stem（供外部按同一规则拼名字）。 */
export function videoStem(relativePath) {
  const base = relativePath.slice(relativePath.lastIndexOf('/') + 1);
  return splitExtension(base).stem;
}
