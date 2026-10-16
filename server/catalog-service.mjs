/**
 * 目录服务：把「扫描结果 + 标注 + 时长缓存 + 缩略图」合成前端要的 Video 列表。
 *
 * 缓存策略：首次访问时扫一次，之后一直用缓存，直到 POST /api/rescan。
 * 视频文件是只读挂载，目录在运行期基本不变，每次请求都全量重扫 131 个文件
 * 只会让内网小机器变慢，且两个接口的 generatedAt 会一直跳动。
 */

import { buildVideoList } from './catalog-build.mjs';
import { loadAnnotations } from './annotations.mjs';
import { loadDurationCache, resolveCacheFile } from './duration-cache.mjs';
import { scanVideoRoot } from './catalog-scan.mjs';

export function createCatalogService(config, { onDurationUpdate } = {}) {
  let cache = null;
  let inFlight = null;

  async function scanNow() {
    const [scan, annotations, durations] = await Promise.all([
      scanVideoRoot(config.videoRoot),
      loadAnnotations(config.annotationsFile),
      loadDurationCache(config.catalogCacheFile),
    ]);
    const built = await buildVideoList({
      scanned: scan,
      annotations,
      durations,
      thumbnailDir: config.thumbnailDir,
    });
    cache = {
      videos: built.videos,
      diagnostics: [...scan.diagnostics, ...annotations.diagnostics, ...durations.diagnostics, ...built.diagnostics],
      byId: new Map(built.videos.map((video) => [video.id, video])),
      // 绝对路径只留在服务端这张表里，序列化给浏览器的只有 videos/diagnostics/generatedAt。
      records: new Map(scan.videos.map((record) => [record.id, record])),
      generatedAt: new Date().toISOString(),
      annotationCount: annotations.videos.size,
      annotationPresent: annotations.present,
      // 目录整个打不开时为 false。它和「目录能读但里面 0 个视频」是两种完全不同的
      // 故障，health 必须能把它们分开，否则容器会一直 healthy 而用户只看到空页面。
      videoRootAvailable: scan.rootAvailable,
    };
    return cache;
  }

  return {
    config,

    /** 拿当前目录；force=true 时强制重扫。并发调用共用同一次扫描。 */
    async get({ force = false } = {}) {
      if (cache !== null && !force) return cache;
      if (inFlight !== null) return inFlight;
      inFlight = scanNow().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },

    /** POST /api/rescan 用。 */
    rescan() {
      return this.get({ force: true });
    },

    /** 只读地看一眼当前缓存（没有则 null），给后台任务用，不触发扫描。 */
    peek() {
      return cache;
    },

    /** 把运行期发现的诊断（比如流播失败）追加进去，下次 /api/videos 能看到。 */
    recordDiagnostic(diagnostic) {
      if (cache === null) return;
      if (cache.diagnostics.length > 500) cache.diagnostics.shift();
      cache.diagnostics.push(diagnostic);
    },

    /** 后台探针补到时长后的回调：只更新内存，不触发重扫（避免自激）。 */
    notifyDurations(found) {
      if (cache === null || found.size === 0) return;
      for (const video of cache.videos) {
        const seconds = found.get(video.relativePath);
        if (seconds === undefined) continue;
        video.durationSeconds = seconds;
        video.available = video.available || seconds > 0;
        if (typeof onDurationUpdate === 'function') onDurationUpdate(video.relativePath, seconds);
      }
    },
  };
}
