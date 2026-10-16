# QA 夹具与工具说明（tests/qa）

本目录由 QA 独占。这里放两类东西：**长期回归测试**和**一次性生成夹具的工具**。

## 怎么跑

根 `vitest.config.ts` 的 `test.projects` 按扩展名分流，`tests/**/*.test.ts` → node、
`tests/**/*.test.tsx` → jsdom，所以 **`pnpm test` 已经包含本目录的全部测试**。

如果根配置被改动导致本目录没被收进去，用本目录自带的配置单独跑：

```bash
npx vitest run --config tests/qa/vitest.config.ts
```

想加进 `package.json`（QA 无权改）：

```json
"test:qa": "vitest run --config tests/qa/vitest.config.ts"
```

## 目录内容

| 文件 | 环境 | 作用 |
| --- | --- | --- |
| `contract.test.ts` | node | 起真实 `server.mjs`（`createServer` 工厂 + 临时视频根），把真实响应喂给真实前端校验器；Range 逐字节比对；路径穿越；只读性；`/api/health` 语义 |
| `stream-process.test.ts` | node | 以**真实子进程**跑 `node server.mjs`，测量服务端 fd 与 RSS（必须独立进程，否则量到的是 vitest 自己的连接池） |
| `real-catalog.test.ts` | node | 把 `fixtures/real-catalog-response.json`（真实 130 条响应）喂给 `validateCatalogResponse` / `filterVideos` / `bucketForDuration` |
| `player-record.test.tsx` | jsdom | 播放记录边界、pagehide 竞态、StrictMode 双挂载、`localStorage` SecurityError、断网文案 |
| `a11y-static.test.ts` | node | 静态审查：FR-008 无上传入口、FR-010 触控 ≥44px、WCAG 对比度实算、aria / 焦点 / `prefers-reduced-motion` |
| `vitest.config.ts` | — | 独立运行用的配置（与根配置等价） |

## 真实夹具怎么来的

`fixtures/real-catalog-response.json` 是 **2026-09-28** 用下面这套环境抓下来的真实响应体
（原样保存，一个字节都没改）：

```bash
# 1) 生成时长缓存（ffprobe 真实读时长）
node tests/qa/tools/build-duration-cache.mjs \
  "/Users/zzymima0000/Developer/coding/1.Active/038-ing-keep 运动健身仓库/KEEP压缩版本" \
  /tmp/qa/annotations-dir/catalog-cache.json

# 2) 起服务（只读挂载真实源目录）
cp catalog/annotations.json /tmp/qa/annotations-dir/annotations.json
VIDEO_ROOT="/Users/zzymima0000/Developer/coding/1.Active/038-ing-keep 运动健身仓库/KEEP压缩版本" \
ANNOTATIONS_FILE=/tmp/qa/annotations-dir/annotations.json \
THUMBNAIL_DIR=scripts/.out/videos/.thumbs \
APP_PORT=8787 node server.mjs

# 3) 抓响应
curl --noproxy '*' -s http://127.0.0.1:8787/api/videos > tests/qa/fixtures/real-catalog-response.json
```

抓到的结果：130 条视频、0 条 diagnostics、50 beginner / 28 intermediate / 16 advanced / 36 unknown、
3 张真实缩略图。坏文件 `keep】晨起唤醒/04 20 分钟晨起唤醒·消除肩颈腰背酸痛·清晨瑜伽.mp4.tmp.mp4`
（ffprobe 时长 0）不出现在列表里。

> 注意：真实源目录有 15 GB，本目录不复制任何视频；`scripts/.out/**` 由别的 agent 使用，QA 只读。
