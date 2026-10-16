#!/usr/bin/env node
/**
 * P038 家庭运动视频库 —— 视频准备工具箱。
 *
 * 六个子命令：
 *   probe      只读盘点源目录（真实 ffprobe 数据 + 磁盘预检 + 样本挑选）
 *   prepare    源 → 目标一对一准备（copy / transcode / auto），可中断可重跑
 *   verify     逐片核对目标目录与 video-map.json
 *   thumbnail  给已准备好的视频生成旁车缩略图（封面优先级 ②）
 *   covers     把用户封面图库接进旁车缩略图目录（封面优先级 ①，图库目录只读）
 *   cache      在**宿主机**上探测播放文件时长，产出服务端要读的 catalog-cache.json
 *              （部署前置步骤：容器镜像里没有 ffprobe，catalog 又只读挂载，
 *               时长缓存只能预先在宿主机生成，见 docs/DEPLOY.md）
 *
 * 硬约束：
 *   - 源目录只读。启动时 stat 快照，结束时比对，不一致就报错。
 *   - 只用 Node 内置模块 + ffmpeg/ffprobe，不新增 npm 依赖。
 *   - ffmpeg/ffprobe 一律走参数数组、shell: false（中文名、空格、`】`、`／`）。
 *   - 运行产物只写 scripts/.out/（或 --out / --report-dir 指定的位置），绝不写进 catalog/。
 *
 * 退出码：0 全部成功 / 2 部分失败（会打印失败清单）/ 1 致命错误 / 130 被信号中断。
 */

import { mkdir, readFile, writeFile, rename, stat, copyFile, unlink, statfs, readdir, realpath, open } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { targetRelativePath, uniqueTarget, splitExtension, sanitizeSegment } from './vid-paths.mjs'
import { probeFile, transcode, sha256File, isTenBit, FFMPEG } from './vid-ffmpeg.mjs'
import { spawn } from 'node:child_process'
import {
  listSourceVideos, snapshotTree, compareSnapshot, groupBySiblingName,
  durationHistogram, stats, tally, formatDuration, formatBytes,
} from './vid-scan.mjs'

// 下面三个 import 是**故意**跨到 server/ 的，为的是让 cache 子命令产出的缓存键
// 与 `/api/videos` 返回的 relativePath 逐字一致 —— 抄一份实现就是复制同类事故的温床：
//   CACHE_FILENAME      服务端读缓存的文件名（server/duration-cache.mjs）
//   relativePosix / normalizeRelativePath  服务端扫描时给每个文件算相对路径的唯一实现
//   isVideoFileName     服务端判定「这个文件算不算视频」的唯一实现（排除 .part./.tmp./隐藏文件）
// 任何一处规则改动，cache 都会自动跟上，不会出现「脚本生成了、服务端查不到」的静默失配。
import { CACHE_FILENAME } from '../server/duration-cache.mjs'
import { isVideoFileName } from '../server/catalog-scan.mjs'
import { normalizeRelativePath, relativePosix } from '../server/ids.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const GIB = 1024 ** 3
/** 磁盘安全余量：8 GiB。留给系统和后续其它 agent 的产物。 */
const SPACE_SAFETY_MARGIN = 8 * GIB
/** 时长比对容差：容器时长元数据本身就不精确，1.5 秒足够宽松也不会漏掉真截断。 */
const DURATION_TOLERANCE = 1.5
/** transcode 模式的体积系数（CRF 24 + veryfast），probe 的空间预检和报告都用它。 */
const DEFAULT_TRANSCODE_RATIO = 0.55
/** 旁车缩略图目录名（默认落位）。可用 `--thumb-dir` 改，见 resolveThumbDir。 */
const THUMB_DIR_NAME = '.thumbs'

/*
 * 缩略图画布契约 —— 必须与前端 CSS 严格一致，改一处就要改另一处。
 *
 * 前端事实（从 src/index.css 核实，不是猜的）：
 *   .video-card__thumb { aspect-ratio: 3 / 4; background: #1d2a45; }
 * 所以缩略图统一输出 480×640（= 480 × 4/3，精确 3:4），补边用 #1d2a45。
 * 这个色值就是封面盒自己的背景色：卡片没封面时的占位块和补出来的边完全同色，
 * 视觉上分不出"这是补出来的"还是"这是原本就有的底"。
 *
 * 为什么必须统一成 3:4（实测依据）：
 *   - CSS 用 object-fit: cover 把图裁进 3:4 的盒子。图片本身就是 3:4 时，
 *     cover 不会裁掉任何像素；图片是别的比例时，cover 会切掉画面。
 *   - 旧输出是 `scale=480:-2`（保持原比例）= 480×1094 的竖版，cover 裁进
 *     3:4 会切掉上下各约 41% 的画面，人物很容易被切脸。
 *
 * 为什么要先 cropdetect（实测依据，本条最关键）：
 *   全库 130 个视频都是 1080×2460，但**其中约 2/3 的黑边是烧在源视频画面里的**
 *   （实测抽样：亮度行分析显示画面只有中间 474 行是亮的，y=993..1466，
 *   上下约 993px 是纯黑像素）。对这类素材，单纯 scale+pad 只会把
 *   "1080×2460 里含黑边的画面"整体缩到 140×320 再左右补边 ——
 *   输出尺寸对了，可画面还是那条细缝（实测 A_recommended.jpg 验证过）。
 *   所以先用 ffmpeg 的 cropdetect 把纯黑边探测出来并裁掉，再缩放补边。
 *   B 类（满幅录屏）cropdetect 返回整帧，滤镜自动退化成 no-op，不受任何影响。
 *
 * 为什么是 240×320 而不是 480×640（这是 P038 白屏事故的核心修复，实测依据）：
 *   真机：红米 Note 12 Pro，1080×2400，3x 密度，MemFree 实测仅 123 MB，
 *   ro.config.low_ram 已置位。Chrome 渲染进程被 OOM 反复杀 → 页面永远白屏
 *   （`Killing com.android.chrome:sandboxed_process0` 循环出现）。
 *   封面盒实测 170×227 CSS px（grid minmax(150px,1fr) + 12px gap，360px 视口下 2 列）。
 *   Chrome 解码后按 宽×高×4 字节常驻，与文件压缩率无关：
 *     480×640 = 1.23 MB/张 → 130 张 160 MB（修前，故障态）
 *     270×360 = 0.39 MB/张 → 266 张 103 MB ✗ 超 100 MB 预算
 *     240×320 = 0.31 MB/张 → 266 张  82 MB ✓ 取这个
 *   取 240 而不是更小的 192：240/170 ≈ 1.4x CSS px，封面里烧进去的中文标题
 *   仍然可读；再降到 192 就开始明显发糊。取 240 而不是 270：266 张的
 *   解码总量必须留在 100 MB 以内（见 CLAUDE.md 里的白屏预算），103 MB 就已经越线。
 *   保持 3:4 是硬契约（见上），240×320 精确 3:4。
 */
/** 缩略图宽度（px）。 */
const THUMB_WIDTH = 240
/** 缩略图高度（px）。240 × 4/3 = 320，与 .video-card__thumb 的 aspect-ratio: 3/4 一致。 */
const THUMB_HEIGHT = 320
/** 补边颜色，对应 CSS 的 `background: #1d2a45`（不含 #，交给 ffmpeg 的 0x 前缀）。 */
const THUMB_PAD_COLOR = '1d2a45'
/** 缩略图滤镜（不含前置的 cropdetect 裁剪段，那部分是逐文件动态拼上去的）。 */
const THUMB_FILTER = [
  // 先按比例缩到"能装进画布"，绝不放大到超过画布
  `scale=${THUMB_WIDTH}:${THUMB_HEIGHT}:force_original_aspect_ratio=decrease`,
  // 装不下的部分用封面底色补齐，居中。(ow-iw)/2 是 ffmpeg 的内置表达式
  `pad=${THUMB_WIDTH}:${THUMB_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0x${THUMB_PAD_COLOR}`,
].join(',')
/** cropdetect 的黑色判定阈值（0-255）。24 足够识别纯黑，又不会把暗部画面误判成黑边。 */
const THUMB_CROPDETECT_LIMIT = 24

/**
 * 用户封面图库（优先级 ①）的滤镜 —— 与 THUMB_FILTER 有意不同：**裁切填满**而不是补边。
 *
 * 为什么不用 pad：图库里的封面是手机截图，原生 1080×2460（宽高比 0.44）。
 * 走 pad 的 `force_original_aspect_ratio=decrease` 会被高度卡住，缩到 140×320，
 * 在 240 宽的盒子里左右各留 50px 纯色边 —— 卡片看起来像"图裂了"，明显比裁切难看。
 * 裁切填满则整张卡片都是真实画面，视觉上也是最好的结果。
 *
 * 三段滤镜：
 *   1. crop  取源图里最大的 3:4 中心区域（`\,` 是 ffmpeg 里 min() 参数分隔符的转义）。
 *      源图正好 3:4 时 min() 两边都等于原值，crop 自动退化成 no-op。
 *   2. scale increase  放大到"能盖满画布"，绝不缩出画布（会产生边）。
 *   3. crop  再切到精确画布。这一步同时兜住第 1 步因奇数取整造成的 1px 比例偏差，
 *      保证 validateThumbSize 一定拿到精确的 240×320，不会有轻微拉伸。
 *
 * 为什么不用 cropdetect：那条链路是为**视频抽帧**设计的（源视频里烧死的黑边），
 * 而图库封面是用户自己截的完整画面，套黑边探测只会误裁主体。抽帧走 ②、图库走 ①，
 * 两条链路各自用合适的滤镜，不互相污染。
 */
const COVER_FILTER = [
  `crop=min(iw\\,ih*3/4):min(ih\\,iw*4/3)`,
  `scale=${THUMB_WIDTH}:${THUMB_HEIGHT}:force_original_aspect_ratio=increase`,
  `crop=${THUMB_WIDTH}:${THUMB_HEIGHT}`,
].join(',')

/**
 * 图库里允许的图片扩展名。刻意不递归接受别的格式：手机截图基本只有 jpg，
 * 少认几种格式比"因为用户拷进来一张 HEIC 就整条命令炸掉"更可控。
 */
const COVER_IMAGE_EXT_RE = /\.(jpg|jpeg)$/i

/**
 * verify 判定"已准备"的状态集合，以及它们的"已准备程度"排序。
 * 数字越大＝越接近"产物本该在磁盘上"，合并多个来源时取分值最高的那个。
 */
const PREPARED_RANK = {
  'not-processed': 0,
  'source-present': 0, // 源目录里扫描到的候选，还没 prepare 过
  'would-run': 0,
  'skipped-unreadable': 0,
  skipped: 1, // 之前 prepare 过、本次跳过（已是最新）
  copied: 2,
  transcoded: 3,
  done: 4, // 产物实测存在且可解析 —— verify 亲自确认，不是记账转述
}
/** 「声明已准备过」的状态：出现这些状态却找不到文件，才是真缺失。 */
const PREPARED_STATUSES = new Set(['copied', 'transcoded', 'skipped', 'done'])

const VIDEO_EXT_RE = /\.(mp4|m4v|mov)$/i

// ---------------------------------------------------------------- 基础设施

class FatalError extends Error {
  constructor(message, code = 'FATAL') {
    super(message)
    this.code = code
  }
}

function log(...args) {
  console.log(...args)
}

function warn(...args) {
  console.error(...args)
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.part`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}

async function writeTextAtomic(file, text) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.part`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, file)
}

/** 简单并发池。ffmpeg 很吃 CPU，所以并发默认 1。 */
async function pool(items, limit, worker) {
  const width = Math.max(1, Math.min(limit, items.length))
  let cursor = 0
  const runners = Array.from({ length: width }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

// ---------------------------------------------------------------- 参数解析

const COMMANDS = new Set(['probe', 'prepare', 'verify', 'thumbnail', 'covers', 'cache'])

const BOOLEAN_FLAGS = new Set([
  'json', 'dry-run', 'force', 'deep', 'strict', 'help', 'h',
  'allow-missing-annotations',
])

const VALUE_FLAGS = new Set([
  'src', 'out', 'mode', 'limit', 'concurrency', 'report-dir', 'ratio', 'videos', 'covers', 'thumb-dir',
])

function parseArgs(argv) {
  const out = { _: [], flags: new Map() }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) { out._.push(token); continue }
    const body = token.slice(2)
    const eq = body.indexOf('=')
    const name = eq >= 0 ? body.slice(0, eq) : body
    if (BOOLEAN_FLAGS.has(name)) {
      out.flags.set(name, eq >= 0 ? body.slice(eq + 1) !== 'false' : true)
      continue
    }
    if (VALUE_FLAGS.has(name)) {
      const value = eq >= 0 ? body.slice(eq + 1) : argv[++i]
      if (value === undefined) throw new FatalError(`--${name} 缺少取值`, 'BAD_ARGS')
      out.flags.set(name, value)
      continue
    }
    throw new FatalError(`未知参数 --${name}`, 'BAD_ARGS')
  }
  return out
}

function flag(parsed, name) { return parsed.flags.get(name) }
function flagStr(parsed, name) { return parsed.flags.get(name) }

function intFlag(parsed, name, fallback) {
  const raw = flagStr(parsed, name)
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) throw new FatalError(`--${name} 需要非负整数，收到 ${raw}`, 'BAD_ARGS')
  return n
}

/**
 * 源目录：--src > VIDEO_SOURCE_DIR > 报错。
 * 刻意不提供硬编码默认值——把别人机器上的绝对路径写死在脚本里，
 * 换台机器就静默指向错误的目录。
 */
function resolveSrcDir(parsed) {
  const raw = flagStr(parsed, 'src') || process.env.VIDEO_SOURCE_DIR
  if (!raw) {
    throw new FatalError(
      '未指定源目录。请传 --src <DIR> 或设置环境变量 VIDEO_SOURCE_DIR。',
      'NO_SOURCE_DIR',
    )
  }
  return path.resolve(raw)
}

/** 目标目录：--out > VIDEO_OUTPUT_DIR > scripts/.out/videos（默认值在仓库内，可重跑可清理）。 */
function resolveOutDir(parsed) {
  const raw = flagStr(parsed, 'out') || process.env.VIDEO_OUTPUT_DIR || path.join(HERE, '.out', 'videos')
  return path.resolve(raw)
}

/**
 * 运行产物目录。默认取目标目录的上一级：
 * 目标目录是 `scripts/.out/videos` → 产物落在 `scripts/.out/`，视频与报告分开。
 */
function resolveReportDir(parsed, outDir) {
  const raw = flagStr(parsed, 'report-dir')
  return path.resolve(raw || path.dirname(outDir))
}

/**
 * 缩略图输出目录：--thumb-dir > <视频根>/.thumbs。
 *
 * 为什么要留这个口子：本机的部署把服务端 THUMBNAIL_DIR 指向
 * `catalog/thumbnails`，而不是脚本默认的 `<视频根>/.thumbs`。两个目录各有 130 张
 * 独立副本（实测 inode 不同），只写默认位置的话服务端读到的还是旧图 ——
 * 症状是「命令跑成功、页面上的封面却一点没变」，极难查。
 * 显式指一次，比让两处副本长期漂移要好。
 */
function resolveThumbDir(parsed, outDir) {
  const raw = flagStr(parsed, 'thumb-dir')
  return raw ? path.resolve(raw) : path.join(outDir, THUMB_DIR_NAME)
}

function resolveMode(parsed) {
  const raw = flagStr(parsed, 'mode') || 'auto'
  if (!['copy', 'transcode', 'auto'].includes(raw)) {
    throw new FatalError(`--mode 只能是 copy|transcode|auto，收到 ${raw}`, 'BAD_ARGS')
  }
  return raw
}

function pad(str, width) {
  const s = String(str)
  let len = 0
  for (const ch of s) len += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(ch) ? 2 : 1
  return s + ' '.repeat(Math.max(0, width - len))
}

/** 样本文件名：把相对路径压成一个平铺名字，只用于 auto-samples 目录。 */
function sanitizeNameForSample(relTarget) {
  return relTarget.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-80)
}

function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(
    [...h].reduce((a, c) => a + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(c) ? 2 : 1), 0),
    ...rows.map((r) => [...String(r[i] ?? '')].reduce((a, c) => a + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(c) ? 2 : 1), 0)),
  ))
  const line = (cells) => cells.map((c, i) => pad(c ?? '', widths[i])).join('  ')
  return [line(headers), widths.map((w) => '─'.repeat(w)).join('  '), ...rows.map(line)].join('\n')
}

// ---------------------------------------------------------------- 分类逻辑

/** 疑似未下载完：文件名里带 `.tmp.`。这是下载器中断留下的痕迹。 */
function isIncompleteName(relPath) {
  const base = relPath.split('/').pop() || ''
  return /\.tmp\./i.test(base)
}

function isReadError(dirErrors, relPath) {
  return dirErrors.some((e) => e.relPath === relPath || relPath.startsWith(`${e.relPath}/`))
}

/**
 * 分类 + 疑似重复分组。
 *
 * 重要事实（实测）：已知的两组"重复"文件（` (2).mp4` 与不带后缀的同名文件）
 * 大小和时长都不一样 —— 那是重新下载/重新压制出的不同版本，不是字节级重复。
 * 所以这里分两类：
 *   duplicate-content   同组内 size 与 duration 完全一致（--deep 时用 sha256 坐实）
 *   sibling-revision    同组但 size/duration 不同 → 名字重复、内容不同，全部保留并报告
 */
async function classify(items, { deep = false } = {}) {
  for (const item of items) {
    const flags = []
    if (isIncompleteName(item.relPath)) flags.push('incomplete')
    if (isReadError(item.readErrors, item.relPath)) flags.push('unreadable-dir')
    if (!item.info.ok) flags.push('unreadable')
    item.flags = flags
  }

  const groups = groupBySiblingName(items)
  const duplicates = []
  const revisions = []
  for (const [, members] of groups) {
    if (members.length < 2) continue
    const readable = members.filter((m) => m.info.ok)
    const sameSize = new Set(readable.map((m) => m.info.size)).size === 1
    const sameDuration = readable.length === members.length
      && new Set(readable.map((m) => m.info.duration.toFixed(3))).size === 1
    if (sameSize && sameDuration && readable.length > 1) {
      const sha = deep ? await Promise.all(readable.map((m) => sha256File(m.absPath))) : null
      const identical = sha ? new Set(sha).size === 1 : null
      duplicates.push({
        reason: identical === null ? 'size+duration 一致（未算 hash）' : identical ? 'sha256 完全一致' : 'size+duration 一致但 sha256 不同',
        hashVerified: deep,
        contentIdentical: identical,
        sha256: sha,
        members: members.map((m) => ({ relPath: m.relPath, size: m.info.size, duration: m.info.duration })),
      })
      for (const m of readable) if (m.flags) m.flags.push('duplicate-content')
    } else {
      revisions.push({
        reason: '同名不同内容（size/duration 不同），全部保留',
        members: members.map((m) => ({
          relPath: m.relPath,
          size: m.info.size,
          duration: m.info.ok ? m.info.duration : null,
          parseOk: m.info.ok,
        })),
      })
      for (const m of members) if (m.flags) m.flags.push('sibling-revision')
    }
  }

  for (const item of items) {
    item.status = item.flags.includes('unreadable') ? 'unreadable'
      : item.flags.includes('incomplete') ? 'incomplete'
        : item.flags.includes('duplicate-content') ? 'duplicate-content'
          : 'ok'
  }
  return { duplicates, revisions }
}

/** 选样本：最短 / 中位 / 最长各一个，再加短名、长名、特殊字符各一个。给真机试播用。 */
function pickSamples(okItems) {
  const byDuration = [...okItems].sort((a, b) => a.info.duration - b.info.duration)
  const byNameLen = [...okItems].sort((a, b) => a.relPath.length - b.relPath.length)
  const specialScore = (item) => {
    const base = item.relPath.split('/').pop() || ''
    const marks = (base.match(/[【】丨／·！？「」（）＋+·《》…—～%&#@]/g) || []).length
    const nonAscii = (base.match(/[^\x20-\x7e]/g) || []).length
    return marks * 3 + nonAscii
  }
  const bySpecial = [...okItems].sort((a, b) => specialScore(b) - specialScore(a))

  const wanted = [
    { item: byDuration[0], reason: '最短' },
    { item: byDuration[Math.floor((byDuration.length - 1) / 2)], reason: '中位时长' },
    { item: byDuration[byDuration.length - 1], reason: '最长' },
    { item: byNameLen[0], reason: '相对路径最短（文件名最短）' },
    { item: byNameLen[byNameLen.length - 1], reason: '相对路径最长（文件名最长）' },
    { item: bySpecial[0], reason: '特殊字符最多（需转义路径试播）' },
  ]
  const seen = new Set()
  const samples = []
  for (const { item, reason } of wanted) {
    if (!item || seen.has(item.relPath)) continue
    seen.add(item.relPath)
    samples.push({
      reason,
      relPath: item.relPath,
      targetRelPath: targetRelativePath(item.relPath),
      durationSeconds: item.info.duration,
      duration: formatDuration(item.info.duration),
      sizeBytes: item.info.size,
      size: formatBytes(item.info.size),
      codec: item.info.codec,
      profile: item.info.profile,
      pixFmt: item.info.pixFmt,
    })
  }
  return samples
}

// ---------------------------------------------------------------- probe

async function buildInventory(srcDir) {
  const found = await listSourceVideos(srcDir)
  const dirErrors = found.filter((f) => f.error).map((f) => ({ relPath: f.relPath, error: f.error }))
  const items = []
  for (const f of found) {
    if (f.error) continue
    const absPath = path.join(srcDir, f.relPath)
    let st
    try {
      st = await stat(absPath)
    } catch (err) {
      items.push({ relPath: f.relPath, absPath, size: 0, mtimeMs: 0, readErrors: [{ relPath: f.relPath, error: err.message }], info: { ok: false, error: err.message } })
      continue
    }
    items.push({ relPath: f.relPath, absPath, size: st.size, mtimeMs: st.mtimeMs, readErrors: dirErrors, info: { ok: false, error: 'not probed yet' } })
  }
  return items
}

async function probeAll(srcDir, { concurrency = 8, deep = false, onProgress } = {}) {
  const items = await buildInventory(srcDir)
  let done = 0
  await pool(items, concurrency, async (item) => {
    item.info = await probeFile(item.absPath)
    done += 1
    onProgress?.(done, items.length, item)
  })
  const classified = await classify(items, { deep })
  return { items, ...classified }
}

async function availableBytes(dir) {
  let target = dir
  while (!existsSync(target) && path.dirname(target) !== target) target = path.dirname(target)
  const s = await statfs(target)
  return { free: s.bavail * s.bsize, volume: target }
}

async function cmdProbe(parsed) {
  const srcDir = resolveSrcDir(parsed)
  const outDir = resolveOutDir(parsed)
  const reportDir = resolveReportDir(parsed, outDir)
  // probe 默认按 copy 估：auto 的实测结论就是"本次仍按 copy 执行"，
  // 用 1.0× 才和 auto 的真实行为一致，标签和数字才对得上。
  const mode = flagStr(parsed, 'mode') || 'copy'
  if (!['copy', 'transcode', 'auto'].includes(mode)) {
    throw new FatalError(`--mode 只能是 copy|transcode|auto，收到 ${mode}`, 'BAD_ARGS')
  }
  const deep = Boolean(flag(parsed, 'deep'))
  const ratio = Number(flagStr(parsed, 'ratio') || DEFAULT_TRANSCODE_RATIO)
  const concurrency = intFlag(parsed, 'concurrency', 8)
  const asJson = Boolean(flag(parsed, 'json'))

  if (!existsSync(srcDir)) throw new FatalError(`源目录不存在：${srcDir}`, 'NO_SOURCE_DIR')
  // probe 是纯只读：这里只 stat 源目录，不建任何文件；产物只写 reportDir。
  const srcStatBefore = await stat(srcDir)

  const startedAt = new Date().toISOString()
  const { items, duplicates, revisions } = await probeAll(srcDir, {
    concurrency,
    deep,
    onProgress: (done, total, item) => {
      if (done === total || done % 10 === 0) {
        process.stderr.write(`
ffprobe ${done}/${total}  ${item.relPath.slice(-48).padEnd(48)}`)
        if (done === total) process.stderr.write('\n')
      }
    },
  })
  const okItems = items.filter((i) => i.status === 'ok')
  // status 是互斥的四选一；但 ".tmp." 标记是与 readability 正交的一个信号，
  // 所以单独列出来（它经常和 unreadable 同时命中，只报 status 会把它藏掉）
  const unreadable = items.filter((i) => i.status === 'unreadable')
  const incomplete = items.filter((i) => i.flags.includes('incomplete'))
  const duplicateContent = items.filter((i) => i.status === 'duplicate-content')

  const durations = okItems.map((i) => i.info.duration)
  const durationStats = stats(durations)
  const sourceBytes = okItems.reduce((a, i) => a + i.info.size, 0)
  const ratioEstimate = mode === 'transcode' ? ratio : 1.0
  const estimatedOutputBytes = Math.round(sourceBytes * ratioEstimate)
  const { free: freeBytes, volume } = await availableBytes(outDir)
  const requiredWithMargin = estimatedOutputBytes + SPACE_SAFETY_MARGIN
  const spaceOk = freeBytes >= requiredWithMargin

  const samples = pickSamples(okItems)
  const longOnes = okItems.filter((i) => i.info.duration >= 1800).length

  const report = {
    tool: 'prepare-videos probe',
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceDir: srcDir,
    outputDir: outDir,
    reportDir,
    mode,
    dryRun: Boolean(flag(parsed, 'dry-run')),
    transcodeRatioAssumed: ratio,
    estimateBasis: mode === 'transcode'
      ? `transcode ${ratio}× 源体积（CRF 24 + veryfast）`
      : 'copy 1.00× 源体积（--mode transcode 时改用 0.55×）',
    deep,
    counts: {
      discovered: items.length,
      ok: okItems.length,
      unreadable: unreadable.length,
      incompleteStatus: items.filter((i) => i.status === 'incomplete').length,
      incompleteNameMarker: incomplete.length,
      duplicateContent: duplicateContent.length,
      directories: new Set(items.map((i) => i.relPath.split('/').slice(0, -1).join('/')).filter(Boolean)).size,
    },
    bytes: {
      readableSourceBytes: sourceBytes,
      readableSourceHuman: formatBytes(sourceBytes),
      estimatedOutputBytes,
      estimatedOutputHuman: formatBytes(estimatedOutputBytes),
    },
    codecs: {
      video: tally(okItems.map((i) => i.info.codec)),
      profile: tally(okItems.map((i) => i.info.profile)),
      pixFmt: tally(okItems.map((i) => i.info.pixFmt)),
      audio: tally(okItems.map((i) => i.info.audioCodec)),
      resolutions: tally(okItems.map((i) => `${i.info.width}x${i.info.height}`)),
      extraStreamShapes: tally(okItems.flatMap((i) => (i.info.extraStreams || []).map((s) => `${s.type}/${s.codec}`))),
    },
    tenBit: {
      count: okItems.filter((i) => isTenBit(i.info)).length,
      ratio: okItems.length ? okItems.filter((i) => isTenBit(i.info)).length / okItems.length : 0,
    },
    duration: {
      min: durationStats.min, max: durationStats.max,
      median: durationStats.median, mean: durationStats.mean,
      minHuman: formatDuration(durationStats.min),
      maxHuman: formatDuration(durationStats.max),
      medianHuman: formatDuration(durationStats.median),
      atLeast30min: longOnes,
      histogram: durationHistogram(durations),
    },
    disk: {
      volume,
      freeBytes,
      freeHuman: formatBytes(freeBytes),
      requiredBytes: requiredWithMargin,
      requiredHuman: formatBytes(requiredWithMargin),
      safetyMarginBytes: SPACE_SAFETY_MARGIN,
      sufficient: spaceOk,
    },
    unreadable: unreadable.map((i) => ({ relPath: i.relPath, size: i.size, error: i.info.error, flags: i.flags })),
    // 注意与 unreadable 列表可能重叠
    incomplete: incomplete.map((i) => ({ relPath: i.relPath, size: i.size, error: i.info.error, flags: i.flags })),
    duplicateContent: duplicates,
    siblingRevisions: revisions,
    samples,
    files: items.map((i) => ({
      relPath: i.relPath,
      status: i.status,
      flags: i.flags,
      // ffprobe 失败时 format.size 也是 NaN，回落到 stat 的字节数
      size: Number.isFinite(i.info.size) ? i.info.size : i.size,
      duration: i.info.ok ? i.info.duration : null,
      codec: i.info.ok ? i.info.codec : null,
      profile: i.info.ok ? i.info.profile : null,
      pixFmt: i.info.ok ? i.info.pixFmt : null,
      bitDepth: i.info.ok ? i.info.bitDepth : null,
      width: i.info.ok ? i.info.width : null,
      height: i.info.ok ? i.info.height : null,
      fps: i.info.ok ? i.info.fps : null,
      videoBitRate: i.info.ok ? i.info.bitRate : null,
      audioCodec: i.info.ok ? i.info.audioCodec : null,
      targetRelPath: targetRelativePath(i.relPath),
      error: i.info.ok ? null : i.info.error,
    })),
  }

  if (!flag(parsed, 'dry-run')) {
    await writeJsonAtomic(path.join(reportDir, 'probe-report.json'), report)
    await writeTextAtomic(path.join(reportDir, 'probe-report.md'), renderProbeMarkdown(report))
  }

  if (asJson) {
    log(JSON.stringify(report, null, 2))
  } else {
    renderProbeHuman(report)
  }

  const srcStatAfter = await stat(srcDir)
  if (srcStatAfter.mtimeMs !== srcStatBefore.mtimeMs) {
    throw new FatalError('源目录 mtime 在 probe 期间发生变化，疑似被改动', 'SOURCE_MUTATED')
  }
  if (!spaceOk) {
    throw new FatalError(
      `磁盘空间不足（INSUFFICIENT_SPACE）：${mode} 模式预计需要 ${formatBytes(estimatedOutputBytes)}`
      + ` + ${formatBytes(SPACE_SAFETY_MARGIN)} 安全余量 = ${formatBytes(requiredWithMargin)}，`
      + `卷 ${volume} 仅剩 ${formatBytes(freeBytes)}。请换 --out 指向更空的卷，或清理空间后重试。`,
      'INSUFFICIENT_SPACE',
    )
  }
  return 0
}

function renderProbeHuman(report) {
  const c = report.counts
  log('')
  log(`源目录      ${report.sourceDir}`)
  log(`目标目录    ${report.outputDir}`)
  log(`产物目录    ${report.reportDir}`)
  log('')
  log('── 盘点 ──')
  log(`文件总数 ${c.discovered}  目录 ${c.directories}  ok ${c.ok}  不可解析 ${c.unreadable}  .tmp. 标记 ${c.incompleteNameMarker}  内容重复 ${c.duplicateContent}`)
  log(`可读源体积 ${report.bytes.readableSourceHuman}`)
  log('')
  log('── 视频轨 ──')
  log(table(['维度', '分布'], [
    ['codec', Object.entries(report.codecs.video).map(([k, v]) => `${k}×${v}`).join('  ')],
    ['profile', Object.entries(report.codecs.profile).map(([k, v]) => `${k}×${v}`).join('  ')],
    ['pix_fmt', Object.entries(report.codecs.pixFmt).map(([k, v]) => `${k}×${v}`).join('  ')],
    ['audio', Object.entries(report.codecs.audio).map(([k, v]) => `${k}×${v}`).join('  ')],
    ['分辨率', Object.entries(report.codecs.resolutions).map(([k, v]) => `${k}×${v}`).join('  ')],
    ['附加轨', Object.entries(report.codecs.extraStreamShapes).map(([k, v]) => `${k}×${v}`).join('  ')],
  ]))
  log('')
  log(`10bit: ${report.tenBit.count}/${report.counts.ok} (${(report.tenBit.ratio * 100).toFixed(1)}%)  ← 安卓硬解风险点`)
  log('')
  log('── 时长 ──')
  log(`min ${report.duration.minHuman}  中位 ${report.duration.medianHuman}  max ${report.duration.maxHuman}  ≥30min ${report.duration.atLeast30min} 个`)
  log(table(['区间', '数量'], report.duration.histogram.map((b) => [b.label, b.count])))
  log('')
  log('── 磁盘预检 ──')
  log(`估算基准 ${report.estimateBasis}`)
  log(`预计输出 ${report.bytes.estimatedOutputHuman}　+　安全余量 ${formatBytes(report.disk.safetyMarginBytes)}　=　需要 ${report.disk.requiredHuman}`)
  log(`卷 ${report.disk.volume} 可用 ${report.disk.freeHuman}　→　${report.disk.sufficient ? '通过' : '不足 INSUFFICIENT_SPACE'}`)
  if (report.unreadable.length) {
    log('')
    log('── 不可解析 ──')
    for (const u of report.unreadable) log(`  ✗ ${u.relPath}  (${formatBytes(u.size)})  ${u.error}`)
  }
  if (report.incomplete.length) {
    log('')
    log('── 下载未完成（文件名含 .tmp.，可能与"不可解析"重叠） ──')
    for (const u of report.incomplete) log(`  ✗ ${u.relPath}  (${formatBytes(u.size)})  ${u.error ?? ''}`)
  }
  if (report.duplicateContent.length) {
    log('')
    log('── 内容重复 ──')
    for (const d of report.duplicateContent) {
      log(`  · ${d.reason}`)
      for (const m of d.members) log(`      ${m.relPath}  ${formatBytes(m.size)}  ${formatDuration(m.duration)}`)
    }
  }
  if (report.siblingRevisions.length) {
    log('')
    log('── 同名不同内容（全部保留） ──')
    for (const d of report.siblingRevisions) {
      for (const m of d.members) log(`      ${m.relPath}  ${formatBytes(m.size)}  ${m.parseOk ? formatDuration(m.duration) : '不可解析'}`)
    }
  }
  log('')
  log('── 样本（真机试播用） ──')
  log(table(['用途', '文件', '时长', '体积'], report.samples.map((s) => [s.reason, s.relPath, s.duration, s.size])))
  log('')
  if (!report.dryRun) {
    log(`报告已写：${path.join(report.reportDir, 'probe-report.json')} / probe-report.md`)
  }
}

function renderProbeMarkdown(report) {
  const lines = []
  lines.push('# P038 视频源盘点报告')
  lines.push('')
  lines.push(`- 生成时间：${report.finishedAt}`)
  lines.push(`- 源目录：\`${report.sourceDir}\``)
  lines.push(`- 目标目录：\`${report.outputDir}\``)
  lines.push(`- 模式：${report.mode}；空间估算基准：${report.estimateBasis}`)
  lines.push(`- sha256 深校验：${report.deep ? '开' : '关（默认启发式：size + duration + 去掉 \` (n)\` 的文件名）'}`)
  lines.push('')
  lines.push('## 汇总')
  lines.push('')
  lines.push('| 指标 | 值 |')
  lines.push('| --- | --- |')
  lines.push(`| 文件总数 | ${report.counts.discovered} |`)
  lines.push(`| 子目录数 | ${report.counts.directories} |`)
  lines.push(`| 可解析 | ${report.counts.ok} |`)
  lines.push(`| 不可解析 | ${report.counts.unreadable} |`)
  lines.push(`| 下载未完成（文件名含 \`.tmp.\`） | ${report.counts.incompleteNameMarker} |`)
  lines.push(`| 内容重复 | ${report.counts.duplicateContent} |`)
  lines.push(`| 可读源体积 | ${report.bytes.readableSourceHuman} |`)
  lines.push(`| 10bit 占比 | ${report.tenBit.count}/${report.counts.ok}（${(report.tenBit.ratio * 100).toFixed(1)}%）|`)
  lines.push(`| 时长 min / 中位 / max | ${report.duration.minHuman} / ${report.duration.medianHuman} / ${report.duration.maxHuman} |`)
  lines.push(`| ≥30 分钟 | ${report.duration.atLeast30min} |`)
  lines.push(`| 可用磁盘 | ${report.disk.freeHuman}（卷 ${report.disk.volume}）|`)
  lines.push(`| 预估输出 / 含余量需求 | ${report.bytes.estimatedOutputHuman} / ${report.disk.requiredHuman} |`)
  lines.push('')
  lines.push('## Codec 分布')
  lines.push('')
  for (const key of ['video', 'profile', 'pixFmt', 'audio', 'resolutions', 'extraStreamShapes']) {
    const entries = Object.entries(report.codecs[key])
    if (!entries.length) continue
    lines.push(`- **${key}**：${entries.map(([k, v]) => `\`${k}\`×${v}`).join('、')}`)
  }
  lines.push('')
  lines.push('## 时长分布')
  lines.push('')
  lines.push('| 区间 | 数量 |')
  lines.push('| --- | --- |')
  for (const b of report.duration.histogram) lines.push(`| ${b.label} | ${b.count} |`)
  lines.push('')
  lines.push('## 样本（真机试播）')
  lines.push('')
  lines.push('| 用途 | 源相对路径 | 目标相对路径 | 时长 | 体积 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const s of report.samples) {
    lines.push(`| ${s.reason} | \`${s.relPath}\` | \`${s.targetRelPath}\` | ${s.duration} | ${s.size} |`)
  }
  if (report.unreadable.length) {
    lines.push('')
    lines.push('## 不可解析文件')
    lines.push('')
    for (const u of report.unreadable) lines.push(`- \`${u.relPath}\`（${formatBytes(u.size)}）：${u.error}`)
  }
  if (report.incomplete.length) {
    lines.push('')
    lines.push('## 下载未完成文件（.tmp.）')
    lines.push('')
    for (const u of report.incomplete) lines.push(`- \`${u.relPath}\`（${formatBytes(u.size)}）：${u.error ?? 'ffprobe 可解析，但文件名标记为下载未完成'}（与上面的"不可解析"列表可能重叠）`)
  }
  if (report.siblingRevisions.length) {
    lines.push('')
    lines.push('## 同名不同内容（疑似重复下载，全部保留）')
    lines.push('')
    for (const d of report.siblingRevisions) {
      lines.push(`- ${d.reason}`)
      for (const m of d.members) lines.push(`  - \`${m.relPath}\` — ${formatBytes(m.size)}，${m.parseOk ? formatDuration(m.duration) : '不可解析'}`)
    }
  }
  if (report.duplicateContent.length) {
    lines.push('')
    lines.push('## 内容完全重复')
    lines.push('')
    for (const d of report.duplicateContent) {
      lines.push(`- ${d.reason}`)
      for (const m of d.members) lines.push(`  - \`${m.relPath}\` — ${formatBytes(m.size)}，${formatDuration(m.duration)}`)
    }
  }
  lines.push('')
  lines.push('## 全部文件')
  lines.push('')
  lines.push('| 状态 | 时长 | 体积 | codec | profile | pix_fmt | 源相对路径 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const f of report.files) {
    lines.push(`| ${f.status} | ${f.duration ? formatDuration(f.duration) : '—'} | ${formatBytes(f.size)} | ${f.codec ?? '—'} | ${f.profile ?? '—'} | ${f.pixFmt ?? '—'} | \`${f.relPath}\` |`)
  }
  return `${lines.join('\n')}\n`
}

// ---------------------------------------------------------------- prepare

/**
 * 目标文件已存在且可解析、时长与源一致（在容差内）→ 可以安全跳过。
 *
 * 只看时长是不够的：实测把一个目标截断到 1 MB 后，moov 在文件头，
 * ffprobe 仍能读出原始 duration，于是"时长一致"被误判成已就绪。
 * 所以 copy 模式额外要求**字节数完全相等**（copy 是逐字节复制的，size 就是完整性凭据）。
 * transcode 模式产物本来就和源不同大小，只能靠时长 + 写完后的原子 rename 保证。
 */
async function alreadyPrepared(targetPath, sourceDuration, { mode, sourceSize } = {}) {
  if (!existsSync(targetPath)) return { skip: false, reason: 'not-exists' }
  const st = await stat(targetPath)
  if (st.size === 0) return { skip: false, reason: 'target-empty' }
  if (mode === 'copy' && Number.isFinite(sourceSize) && st.size !== sourceSize) {
    return { skip: false, reason: `size-mismatch ${st.size} vs ${sourceSize}` }
  }
  const info = await probeFile(targetPath)
  if (!info.ok) return { skip: false, reason: `target-unreadable: ${info.error}` }
  if (sourceDuration !== null && Math.abs(info.duration - sourceDuration) > DURATION_TOLERANCE) {
    return { skip: false, reason: `duration-mismatch ${info.duration.toFixed(3)}s vs ${sourceDuration.toFixed(3)}s` }
  }
  return { skip: true, reason: 'already-prepared', size: st.size, duration: info.duration }
}

async function copyOne(srcPath, dstPath) {
  await mkdir(path.dirname(dstPath), { recursive: true })
  await copyFile(srcPath, dstPath)
  return { ok: true }
}

async function transcodeOne(srcPath, dstPath, sourceDuration, onProgress) {
  await mkdir(path.dirname(dstPath), { recursive: true })
  const part = `${dstPath}.part.mp4`
  await unlink(part).catch(() => {})
  const res = await transcode(srcPath, part, { durationSeconds: sourceDuration, onProgress })
  if (!res.ok) {
    await unlink(part).catch(() => {})
    return { ok: false, error: `ffmpeg 退出码 ${res.code}: ${res.stderr || '(无 stderr)'}` }
  }
  // 转完必须重新 ffprobe 校验：ffmpeg 退出码 0 不等于时长对得上
  const info = await probeFile(part)
  if (!info.ok) {
    await unlink(part).catch(() => {})
    return { ok: false, error: `转码产物不可解析: ${info.error}` }
  }
  if (Math.abs(info.duration - sourceDuration) > DURATION_TOLERANCE) {
    await unlink(part).catch(() => {})
    return { ok: false, error: `转码时长偏差超容差: ${info.duration.toFixed(3)}s vs ${sourceDuration.toFixed(3)}s` }
  }
  await rename(part, dstPath)
  return { ok: true, size: info.size, duration: info.duration }
}

async function cmdPrepare(parsed) {
  const srcDir = resolveSrcDir(parsed)
  const outDir = resolveOutDir(parsed)
  const reportDir = resolveReportDir(parsed, outDir)
  const requestedMode = resolveMode(parsed)
  const limit = intFlag(parsed, 'limit', Infinity)
  const force = Boolean(flag(parsed, 'force'))
  const dryRun = Boolean(flag(parsed, 'dry-run'))
  const asJson = Boolean(flag(parsed, 'json'))
  // 源里已知有截断文件（moov atom not found）。默认把它记为 skipped-unreadable 并明确报出来，
  // 而不是让整批永远 exit 2；--strict 则要求它算失败。
  const strict = Boolean(flag(parsed, 'strict'))
  const concurrency = intFlag(parsed, 'concurrency', 1)

  if (!existsSync(srcDir)) throw new FatalError(`源目录不存在：${srcDir}`, 'NO_SOURCE_DIR')

  // 源目录只读：开工前拍快照，收工时比对
  const sourceSnapshot = await snapshotTree(srcDir)

  // 目标名一一对应且稳定：先算出全部映射（含去重后缀），再动手
  const discovered = (await listSourceVideos(srcDir)).filter((f) => !f.error)
  const taken = new Set()
  const plan = discovered.map((f) => {
    const relTarget = uniqueTarget(targetRelativePath(f.relPath), taken)
    taken.add(relTarget)
    return { relSource: f.relPath, relTarget, absSource: path.join(srcDir, f.relPath), absTarget: path.join(outDir, relTarget) }
  })
  const renamedTargets = plan.filter((p) => p.relTarget !== targetRelativePath(p.relSource))

  // transcode / auto 需要全量时长（排序 + 校验），copy 模式按需逐个探测，保持 --limit 下的速度
  let items = plan
  if (requestedMode !== 'copy') {
    const probed = []
    for (const p of plan) {
      const info = await probeFile(p.absSource)
      probed.push({ ...p, sourceInfo: info })
    }
    items = probed.filter((p) => p.sourceInfo.ok)
    // 短的先转：坏样本早暴露
    items.sort((a, b) => a.sourceInfo.duration - b.sourceInfo.duration)
  }
  const selected = items.slice(0, limit === Infinity ? items.length : limit)

  // auto：先转最短+最长各一个并校验，任一失败就整体退回 copy。
  // 明确不因为样本通过就在 auto 模式下全量开转码——那是用户的决定，不是工具的。
  let effectiveMode = requestedMode
  const autoSamples = []
  let autoFallbackReason = null
  let autoDecision = requestedMode === 'auto' ? 'dry-run，未执行样本转码' : null
  if (requestedMode === 'auto' && !dryRun) {
    const readable = items.filter((p) => p.sourceInfo?.ok)
    const picks = [readable[0], readable[readable.length - 1]].filter(Boolean)
    const sampleDir = path.join(reportDir, 'auto-samples')
    for (const [index, p] of picks.entries()) {
      // 样本放平铺一层，别在 auto-samples 下再复制整棵目录树
      const name = `${String(index + 1).padStart(2, '0')}-${sanitizeNameForSample(p.relTarget)}`
      const samplePath = path.join(sampleDir, name)
      log(`auto 样本转码 ${index + 1}/${picks.length}：${p.relSource} → ${path.relative(reportDir, samplePath)}`)
      const res = await transcodeOne(p.absSource, samplePath, p.sourceInfo.duration, (pct) => {
        if (pct % 10 < 0.5) process.stdout.write(`  转码进度 ${pct.toFixed(0)}%\r`)
      })
      process.stdout.write('\n')
      const srcSize = p.sourceInfo.size
      let outSize = null
      try { outSize = (await stat(samplePath)).size } catch { outSize = null }
      autoSamples.push({
        role: p === picks[0] ? 'shortest' : 'longest',
        relSource: p.relSource,
        sampleRelPath: path.relative(reportDir, samplePath),
        durationSeconds: p.sourceInfo.duration,
        duration: formatDuration(p.sourceInfo.duration),
        sourceSizeBytes: srcSize,
        sourceSize: formatBytes(srcSize),
        outputSizeBytes: outSize,
        outputSize: formatBytes(outSize),
        sizeRatio: outSize && srcSize ? Number((outSize / srcSize).toFixed(4)) : null,
        ok: res.ok,
        error: res.error ?? null,
      })
      if (!res.ok) { autoFallbackReason = res.error; break }
    }
    const allOk = autoSamples.length > 0 && autoSamples.every((s) => s.ok)
    // 关键：auto 只用来"验证转码可行"并给出体积证据，绝不自动把 131 个文件全转一遍。
    // 全量转码是用户的决定：确认后显式跑 --mode transcode。
    effectiveMode = 'copy'
    if (!allOk) autoFallbackReason = autoFallbackReason || '样本校验未全部通过'
    autoDecision = allOk
      ? '样本转码通过 → 本次仍按 copy 执行（全量转码请显式 --mode transcode）'
      : `样本转码失败 → 退回 copy：${autoFallbackReason}`
    log(`auto 决策：${autoDecision}`)
  } else if (requestedMode === 'auto') {
    effectiveMode = 'copy'
  }

  // 磁盘预检：按实际模式估
  let plannedSourceBytes = 0
  for (const p of selected) {
    try {
      plannedSourceBytes += (await stat(p.absSource)).size
    } catch { /* 探测阶段已记录 */ }
  }
  const ratio = effectiveMode === 'transcode' ? Number(flagStr(parsed, 'ratio') || DEFAULT_TRANSCODE_RATIO) : 1.0
  const { free: freeBytes, volume } = await availableBytes(outDir)
  const requiredBytes = Math.round(plannedSourceBytes * ratio) + SPACE_SAFETY_MARGIN
  if (!dryRun && freeBytes < requiredBytes) {
    throw new FatalError(
      `磁盘空间不足（INSUFFICIENT_SPACE）：${effectiveMode} 模式本次需要 ${formatBytes(Math.round(plannedSourceBytes * ratio))}`
      + ` + ${formatBytes(SPACE_SAFETY_MARGIN)} 安全余量 = ${formatBytes(requiredBytes)}，卷 ${volume} 仅剩 ${formatBytes(freeBytes)}。`,
      'INSUFFICIENT_SPACE',
    )
  }

  // 信号处理：不打断正在跑的那一个文件，等它收尾（.part 会被 rename 或删掉）再退出
  let aborting = false
  const onSignal = (sig) => {
    if (aborting) return
    aborting = true
    warn(`\n收到 ${sig}：不再启动新文件，等当前文件收尾后保存进度退出。`)
  }
  process.on('SIGINT', () => onSignal('SIGINT'))
  process.on('SIGTERM', () => onSignal('SIGTERM'))

  const state = {
    tool: 'prepare-videos prepare',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    sourceDir: srcDir,
    outputDir: outDir,
    reportDir,
    requestedMode,
    effectiveMode,
    dryRun,
    force,
    limit: limit === Infinity ? null : limit,
    concurrency,
    autoSamples,
    autoDecision,
    autoFallbackReason,
    targetRenames: renamedTargets,
    strict,
    counts: { planned: selected.length, copied: 0, transcoded: 0, skipped: 0, skippedUnreadable: 0, failed: 0 },
    failures: [],
    items: [],
  }

  log(`模式 ${effectiveMode}（请求 ${requestedMode}）　源 ${srcDir}　目标 ${outDir}`)
  log(`共 ${selected.length} 个文件待处理　预计新增 ${formatBytes(Math.round(plannedSourceBytes * ratio))}　卷可用 ${formatBytes(freeBytes)}`)
  if (dryRun) log('dry-run：不会写入任何文件。')

  let index = 0
  let lastPercent = new Map()
  await pool(selected, concurrency, async (item) => {
    if (aborting) return
    index += 1
    const seq = String(index).padStart(3, ' ')
    const sourceInfo = item.sourceInfo ?? await probeFile(item.absSource)
    if (!sourceInfo.ok) {
      // dry-run 不做功，所以不计入失败；真实执行时默认跳过并记账，--strict 下才算失败
      if (dryRun) {
        state.items.push({ relSource: item.relSource, relTarget: item.relTarget, status: 'would-fail', error: `源不可解析: ${sourceInfo.error}` })
        state.counts.skippedUnreadable += 1
        log(`${seq}/${selected.length} ✗ 源不可解析（dry-run 不计失败）  ${item.relSource}  ${sourceInfo.error}`)
        return
      }
      const record = { relSource: item.relSource, relTarget: item.relTarget, status: strict ? 'failed' : 'skipped-unreadable', error: `源不可解析: ${sourceInfo.error}` }
      state.items.push(record)
      state.counts.skippedUnreadable += 1
      if (strict) { state.failures.push(record); state.counts.failed += 1 }
      log(`${seq}/${selected.length} ✗ 源不可解析${strict ? '' : '（跳过，不算失败；加 --strict 可让其计为失败）'}  ${item.relSource}  ${sourceInfo.error}`)
      return
    }
    const sourceDuration = sourceInfo.duration

    if (!force) {
      const already = await alreadyPrepared(item.absTarget, sourceDuration, {
        mode: effectiveMode,
        sourceSize: sourceInfo.size,
      })
      if (already.skip) {
        state.items.push({ relSource: item.relSource, relTarget: item.relTarget, status: 'skipped', size: already.size, duration: already.duration })
        state.counts.skipped += 1
        log(`${seq}/${selected.length} · 跳过（已就绪）  ${item.relTarget}  ${formatBytes(already.size)}  ${formatDuration(already.duration)}`)
        return
      }
      if (dryRun) {
        state.items.push({ relSource: item.relSource, relTarget: item.relTarget, status: 'would-run', reason: already.reason, duration: sourceDuration, size: sourceInfo.size })
        log(`${seq}/${selected.length} ○ 待处理（${already.reason}）  ${item.relSource} → ${item.relTarget}  ${formatBytes(sourceInfo.size)}  ${formatDuration(sourceDuration)}`)
        return
      }
    } else if (dryRun) {
      state.items.push({ relSource: item.relSource, relTarget: item.relTarget, status: 'would-run', reason: 'force', duration: sourceDuration, size: sourceInfo.size })
      log(`${seq}/${selected.length} ○ 待处理（--force 强制重做）  ${item.relSource} → ${item.relTarget}`)
      return
    }

    const started = Date.now()
    let res
    if (effectiveMode === 'transcode') {
      res = await transcodeOne(item.absSource, item.absTarget, sourceDuration, (pct) => {
        // 每 10% 一行就够看出在动，再密就只是刷屏
        const bucket = Math.floor(pct / 10)
        if (lastPercent.get(item.relSource) !== bucket) {
          lastPercent.set(item.relSource, bucket)
          log(`${seq}/${selected.length} ⇄ 转码中 ${pct.toFixed(0)}%  ${item.relTarget}`)
        }
      })
    } else {
      res = await copyOne(item.absSource, item.absTarget)
      if (res.ok) {
        const info = await probeFile(item.absTarget)
        if (!info.ok) res = { ok: false, error: `复制产物不可解析: ${info.error}` }
        else if (Math.abs(info.duration - sourceDuration) > DURATION_TOLERANCE) res = { ok: false, error: `复制后时长偏差: ${info.duration.toFixed(3)}s vs ${sourceDuration.toFixed(3)}s` }
        else res = { ok: true, size: info.size, duration: info.duration }
      }
    }
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    if (res.ok) {
      const status = effectiveMode === 'transcode' ? 'transcoded' : 'copied'
      state.counts[status] += 1
      state.items.push({ relSource: item.relSource, relTarget: item.relTarget, status, size: res.size, duration: res.duration, sourceSize: sourceInfo.size, sourceDuration })
      log(`${seq}/${selected.length} ✓ ${status}  ${item.relTarget}  ${formatBytes(res.size)}  ${formatDuration(res.duration)}  ${elapsed}s`)
    } else {
      state.counts.failed += 1
      const record = { relSource: item.relSource, relTarget: item.relTarget, status: 'failed', error: res.error }
      state.items.push(record)
      state.failures.push(record)
      log(`${seq}/${selected.length} ✗ 失败  ${item.relSource}  ${res.error}`)
    }

    // 每处理完一个文件就落盘进度：Ctrl-C / 断电后重跑能接着来
    if (!dryRun) await persist(state, reportDir)
  })

  state.finishedAt = new Date().toISOString()
  state.interrupted = aborting
  if (!dryRun) {
    await persist(state, reportDir)
    const mapPath = path.join(reportDir, 'video-map.json')
    let previousMap = null
    if (existsSync(mapPath)) {
      try { previousMap = JSON.parse(await readFile(mapPath, 'utf8')) } catch { previousMap = null }
    }
    await writeJsonAtomic(mapPath, buildVideoMap(state, plan, sourceSnapshot, previousMap))
  }

  // 源目录只读的证明
  const after = await snapshotTree(srcDir)
  const diffs = compareSnapshot(sourceSnapshot, after)
  state.sourceMutations = diffs
  if (!dryRun) await persist(state, reportDir)

  const summary = {
    dryRun,
    interrupted: aborting,
    requestedMode,
    effectiveMode,
    counts: state.counts,
    autoSamples,
    autoDecision,
    autoFallbackReason,
    failures: state.failures,
    sourceMutations: diffs,
    videoMap: dryRun ? null : path.join(reportDir, 'video-map.json'),
  }

  if (asJson) log(JSON.stringify(summary, null, 2))
  else {
    log('')
    log(`完成：复制 ${state.counts.copied}　转码 ${state.counts.transcoded}　跳过（已就绪）${state.counts.skipped}　跳过（源不可解析）${state.counts.skippedUnreadable}　失败 ${state.counts.failed}`)
    if (state.failures.length) {
      log('')
      log('失败清单：')
      for (const f of state.failures) log(`  ✗ ${f.relSource} → ${f.relTarget}  ${f.error}`)
    }
    if (diffs.length) {
      warn('')
      warn(`⚠ 源目录发生变化（${diffs.length} 项），这不应该发生：`)
      for (const d of diffs.slice(0, 20)) warn(`  ${d.change}  ${d.rel}`)
    }
    if (!dryRun) log(`进度与映射：${path.join(reportDir, 'prepare-state.json')} / ${path.join(reportDir, 'video-map.json')}`)
  }

  if (diffs.length) throw new FatalError(`源目录被改动：${diffs.length} 项差异`, 'SOURCE_MUTATED')
  if (aborting) return 130
  if (state.counts.failed > 0) return 2
  return 0
}

async function persist(state, reportDir) {
  await writeJsonAtomic(path.join(reportDir, 'prepare-state.json'), state)
}

/**
 * video-map.json：相对源路径 → 相对目标路径，外加校验需要的源侧元数据。
 * 服务的 verify/缩略图推导都以此为准。
 */
function buildVideoMap(state, plan, sourceSnapshot, previous) {
  const bySource = new Map(state.items.map((i) => [i.relSource, i]))
  // map 必须跨次累积：一次 --limit 3 的运行不该把上一轮已经记好的 100 个条目抹掉
  const prevBySource = new Map((previous?.entries ?? []).map((e) => [e.relSource, e]))
  return {
    tool: 'prepare-videos video-map',
    generatedAt: new Date().toISOString(),
    sourceDir: state.sourceDir,
    outputDir: state.outputDir,
    effectiveMode: state.effectiveMode,
    // 路径转义规则：服务若要自行推导目标名，必须用同一套规则
    pathRules: {
      escape: '~hhhh~（4 位十六进制码位），仅转义 / \\ : * ? " < > | ~ 控制字符 及全角 ／(U+FF0F)；其余字符（含中文、空格、】、丨）原样保留',
      target: '镜像源目录结构，每段过一遍转义，扩展名统一 .mp4',
      thumbnailDir: `${THUMB_DIR_NAME}（放在视频根目录下，内部按视频相对路径镜像，文件名 = 视频名去扩展名 + .jpg）`,
    },
    durationToleranceSeconds: DURATION_TOLERANCE,
    entries: plan.map((p) => {
      const record = bySource.get(p.relSource)
      const prev = prevBySource.get(p.relSource)
      const snap = sourceSnapshot.get(p.relSource)
      return {
        relSource: p.relSource,
        relTarget: p.relTarget,
        relThumb: p.relTarget.replace(/\.mp4$/i, '.jpg'),
        status: record?.status ?? prev?.status ?? 'not-processed',
        sourceSize: snap?.size ?? prev?.sourceSize ?? null,
        sourceDuration: record?.duration ?? record?.sourceDuration ?? prev?.sourceDuration ?? null,
        targetSize: record?.size ?? prev?.targetSize ?? null,
        targetDuration: record?.duration ?? prev?.targetDuration ?? null,
        error: record?.error ?? prev?.error ?? null,
        updatedAt: record ? state.finishedAt ?? new Date().toISOString() : prev?.updatedAt ?? null,
      }
    }),
  }
}

// ---------------------------------------------------------------- verify

async function listTargetVideos(outDir) {
  const out = []
  async function walk(relDir) {
    const abs = relDir ? path.join(outDir, relDir) : outDir
    let entries
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (rel === THUMB_DIR_NAME) continue // 旁车目录不是视频
        await walk(rel)
      } else if (entry.isFile() && VIDEO_EXT_RE.test(entry.name) && !entry.name.endsWith('.part.mp4')) {
        out.push({ relPath: rel, absPath: path.join(outDir, rel) })
      }
    }
  }
  await walk('')
  out.sort((a, b) => a.relPath.localeCompare(b.relPath, 'zh-Hans-CN'))
  return out
}

/**
 * 构建 verify 的"期望集合"。
 *
 * 背景（这是本函数存在的唯一理由）：旧实现只读 `video-map.json`（probe 阶段的快照），
 * 于是产生两个结构性错误：
 *   1. prepare 跑完不回写 map，所以磁盘上早已转码完成的文件，mapStatus 仍是
 *      `not-processed`（实测 107 个产物里 104 个如此）；
 *   2. `missing` 只在 map 的 status 属于 {copied,transcoded,skipped} 时才触发，
 *      而 probe 把所有候选都标成 `not-processed` —— 于是 **`missing` 恒为 0**，
 *      产物被删掉也只会进 `notPrepared`，永远报不出"缺失"。
 *
 * 现在期望集合来自三个来源的并集：
 *   - live      实际扫描源目录（--src / VIDEO_SOURCE_DIR）。这是**真实**的源集合，
 *               新增/删除的源文件立刻反映出来，不会被陈旧快照锁死。
 *   - state     `prepare-state.json` 的 items：prepare 自己记账的逐条结果。
 *   - map       `video-map.json`：probe 的快照，作为兜底补齐前两者都没提到的条目。
 *
 * 每条期望记录带 `from`（来源数组）与 `plannedStatus`（各来源里"最已准备"的状态）。
 * 磁盘上真实存在的文件，其状态一律记为 `done` —— 产物在就是 done，
 * 不再受任何陈旧记账的影响。
 */
async function buildExpectedSet({ reportDir, srcDir, probeReport }) {
  /** relTarget → { relTarget, relSource, sourceDuration, from:Set, plannedStatus } */
  const expected = new Map()

  const add = (relTarget, patch = {}) => {
    let e = expected.get(relTarget)
    if (!e) {
      e = { relTarget, relSource: null, sourceDuration: null, from: new Set(), plannedStatus: null }
      expected.set(relTarget, e)
    }
    if (patch.from) e.from.add(patch.from)
    if (patch.relSource && !e.relSource) e.relSource = patch.relSource
    if (patch.sourceDuration != null && e.sourceDuration == null) e.sourceDuration = patch.sourceDuration
    if (patch.status && PREPARED_RANK[patch.status] > (PREPARED_RANK[e.plannedStatus] ?? -1)) {
      e.plannedStatus = patch.status
    }
    return e
  }

  const mapPath = path.join(reportDir, 'video-map.json')
  if (existsSync(mapPath)) {
    const map = JSON.parse(await readFile(mapPath, 'utf8'))
    for (const entry of map.entries ?? []) {
      add(entry.relTarget, {
        from: 'map',
        status: entry.status,
        relSource: entry.relSource,
        sourceDuration: entry.sourceDuration,
      })
    }
  }

  const statePath = path.join(reportDir, 'prepare-state.json')
  if (existsSync(statePath)) {
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    for (const item of state.items ?? []) {
      add(item.relTarget, {
        from: 'state',
        status: item.status,
        relSource: item.relSource,
        sourceDuration: item.sourceDuration ?? item.duration,
      })
    }
  }

  // 源目录实扫。probe 判定为 unreadable / incomplete 的源文件本来就不该有产物，
  // 把它们算进期望集合会永远报 missing，所以按 probe 的判定排除并单独记账。
  let sourceScanned = 0
  const excluded = []
  if (srcDir && existsSync(srcDir)) {
    const probeByTarget = new Map((probeReport?.files ?? []).map((f) => [targetRelativePath(f.relPath), f]))
    for (const f of await listSourceVideos(srcDir)) {
      if (f.error) continue
      const relTarget = targetRelativePath(f.relPath)
      const probed = probeByTarget.get(relTarget)
      if (probed && probed.status !== 'ok') {
        excluded.push({ relTarget, reason: `源不可用（probe: ${probed.status}）` })
        continue
      }
      sourceScanned += 1
      add(relTarget, { from: 'live', status: 'source-present', relSource: f.relPath, sourceDuration: probed?.duration ?? null })
    }
  }

  return {
    expected,
    sourceScanned,
    excluded,
    sources: {
      live: srcDir && existsSync(srcDir) ? srcDir : null,
      state: existsSync(statePath) ? statePath : null,
      map: existsSync(mapPath) ? mapPath : null,
    },
  }
}

async function cmdVerify(parsed) {
  const outDir = resolveOutDir(parsed)
  const reportDir = resolveReportDir(parsed, outDir)
  const asJson = Boolean(flag(parsed, 'json'))
  const concurrency = intFlag(parsed, 'concurrency', 8)
  // verify 以前完全不碰源目录。合并源目录实扫之后它是**可选**的：
  // 传了/环境变量有就实扫，没有就只靠 state + map（并在输出里说清楚）。
  const srcDirRaw = flagStr(parsed, 'src') || process.env.VIDEO_SOURCE_DIR || null
  const srcDir = srcDirRaw ? path.resolve(srcDirRaw) : null

  // 目标目录还不存在 = 还没 prepare 过，这是合法状态（verify 只核对，不负责准备），
  // 所以报 0 个文件并退出 0；只有"核对出了不一致"才该非 0。
  if (!existsSync(outDir)) {
    const report = {
      tool: 'prepare-videos verify',
      verifiedAt: new Date().toISOString(),
      outputDir: outDir,
      reportDir,
      videoMap: null,
      durationToleranceSeconds: DURATION_TOLERANCE,
      note: '目标目录不存在，尚未 prepare 过；没有可核对的内容。',
      counts: { files: 0, ok: 0, unreadable: 0, durationMismatch: 0, inMap: 0, missing: 0, notPrepared: 0, orphans: 0 },
      unreadable: [], durationMismatch: [], missing: [], notPrepared: [], orphans: [], files: [],
    }
    if (asJson) log(JSON.stringify(report, null, 2))
    else log(`目标目录 ${outDir} 尚不存在，尚未 prepare 过；没有可核对的内容。`)
    return 0
  }

  const probeReportPath = path.join(reportDir, 'probe-report.json')
  const probeReport = existsSync(probeReportPath) ? JSON.parse(await readFile(probeReportPath, 'utf8')) : null
  const { expected, sourceScanned, excluded, sources } = await buildExpectedSet({ reportDir, srcDir, probeReport })

  const files = await listTargetVideos(outDir)
  const results = []
  await pool(files, concurrency, async (f) => {
    const info = await probeFile(f.absPath)
    const exp = expected.get(f.relPath) ?? null
    const mismatch = info.ok && exp?.sourceDuration != null
      ? Math.abs(info.duration - exp.sourceDuration) > DURATION_TOLERANCE
      : null
    results.push({
      relTarget: f.relPath,
      // inMap 保留原字段名（验收与文档在引用），现在代表"在期望集合里"
      inMap: Boolean(exp),
      // mapStatus 保留字段名，但语义修好了：产物实测存在且可解析就是 done。
      // 旧行为是照抄 video-map 的陈旧 status，转码完成后仍显示 not-processed。
      mapStatus: info.ok ? 'done' : 'unreadable',
      // 记账转述的状态单独放一个字段，别再和实测结论混用
      plannedStatus: exp?.plannedStatus ?? null,
      expectedFrom: exp ? [...exp.from] : [],
      expected: Boolean(exp),
      ok: info.ok,
      error: info.ok ? null : info.error,
      duration: info.ok ? info.duration : null,
      durationHuman: info.ok ? formatDuration(info.duration) : '—',
      codec: info.ok ? info.codec : null,
      profile: info.ok ? info.profile : null,
      pixFmt: info.ok ? info.pixFmt : null,
      size: info.size,
      sourceDuration: exp?.sourceDuration ?? null,
      durationDelta: info.ok && exp?.sourceDuration != null ? Number((info.duration - exp.sourceDuration).toFixed(3)) : null,
      mismatch,
    })
  })

  results.sort((a, b) => a.relTarget.localeCompare(b.relTarget, 'zh-Hans-CN'))
  // 期望集合里"声明已准备过"却不在磁盘上的，才是真缺失。
  // 判据取三个来源合并后的 plannedStatus（取"最已准备"的一方），
  // 所以 prepare-state 里记了 transcoded 的条目一旦被删，这里必定报出来。
  const onDisk = new Set(results.map((r) => r.relTarget))
  const missing = [...expected.values()]
    .filter((e) => PREPARED_STATUSES.has(e.plannedStatus) && !onDisk.has(e.relTarget))
    .map((e) => ({ relTarget: e.relTarget, status: e.plannedStatus, from: [...e.from] }))
  // 还没准备过的：源目录里在、但 prepare 还没跑到（--limit / 中断 / 排队中）
  const notPrepared = [...expected.values()]
    .filter((e) => !onDisk.has(e.relTarget) && !PREPARED_STATUSES.has(e.plannedStatus))
    .map((e) => ({ relTarget: e.relTarget, status: e.plannedStatus, from: [...e.from] }))
  // 孤儿：目标目录里有、但期望集合里没有。服务应忽略它们，这里报出来。
  const orphans = results.filter((r) => !r.expected).map((r) => r.relTarget)
  const unreadable = results.filter((r) => !r.ok)
  const mismatched = results.filter((r) => r.mismatch)

  const report = {
    tool: 'prepare-videos verify',
    verifiedAt: new Date().toISOString(),
    outputDir: outDir,
    reportDir,
    videoMap: sources.map,
    // 期望集合的口径说明（`missing` 能不能信，看这一段就够）
    expectedFrom: {
      // 实际扫描到的源文件数；null = 本次没扫源目录（没传 --src 也没有环境变量）
      liveSourceScanned: sources.live ? sourceScanned : null,
      liveSourceDir: sources.live,
      prepareState: sources.state,
      videoMap: sources.map,
      note: sources.live
        ? '期望集合 = 源目录实扫 ∪ prepare-state.json ∪ video-map.json；'
          + '磁盘上存在且可解析的产物状态一律为 done。missing = 声明已准备过却不在磁盘上。'
        : '未提供源目录（--src / VIDEO_SOURCE_DIR），期望集合 = prepare-state.json ∪ video-map.json；'
          + '建议补上 --src 以便发现"源目录新增了但还没 prepare"的条目。',
    },
    // probe 判定不可用的源文件（如 moov atom 缺失的 .tmp.mp4）本来就不该有产物，
    // 排除在期望集合之外，否则会永远报 missing
    excludedFromExpected: excluded,
    durationToleranceSeconds: DURATION_TOLERANCE,
    counts: {
      expected: expected.size,
      files: results.length,
      ok: results.filter((r) => r.ok).length,
      unreadable: unreadable.length,
      durationMismatch: mismatched.length,
      inMap: results.filter((r) => r.expected).length,
      missing: missing.length,
      notPrepared: notPrepared.length,
      orphans: orphans.length,
      done: results.filter((r) => r.mapStatus === 'done').length,
    },
    unreadable,
    durationMismatch: mismatched,
    missing,
    notPrepared,
    orphans,
    files: results,
  }

  if (asJson) log(JSON.stringify(report, null, 2))
  else {
    log('')
    log(`目标目录 ${outDir}`)
    log(`期望来源  源目录实扫 ${sources.live ? `${sourceScanned} 个（${sources.live}）` : '未提供（建议加 --src）'}`)
    log(`          prepare-state ${sources.state ? '已读' : '缺失'}　video-map ${sources.map ? '已读' : '缺失'}`)
    log('')
    log(table(
      ['状态', '时长', '与源差', '体积', 'codec', '文件'],
      results.map((r) => [
        r.ok ? 'ok' : '✗ 不可解析',
        r.durationHuman,
        r.durationDelta === null ? '—' : `${r.durationDelta > 0 ? '+' : ''}${r.durationDelta}s`,
        formatBytes(r.size),
        r.codec ?? '—',
        r.relTarget,
      ]),
    ))
    log('')
    log(`期望 ${report.counts.expected}　文件 ${report.counts.files}　可解析 ${report.counts.ok}　不可解析 ${report.counts.unreadable}　时长不一致 ${report.counts.durationMismatch}　缺失 ${report.counts.missing}　孤儿 ${report.counts.orphans}　未准备 ${report.counts.notPrepared}`)
    if (excluded.length) log(`\n另有 ${excluded.length} 个源文件按 probe 判定不可用，未计入期望集合：`)
    if (unreadable.length) { log(''); log('不可解析：'); for (const r of unreadable) log(`  ✗ ${r.relTarget}  ${r.error}`) }
    if (mismatched.length) { log(''); log('时长不一致（超过 ' + DURATION_TOLERANCE + 's 容差）：'); for (const r of mismatched) log(`  ✗ ${r.relTarget}  源 ${r.sourceDuration?.toFixed(3)}s → 目标 ${r.duration?.toFixed(3)}s`) }
    if (missing.length) { log(''); log('声明已准备但目标目录缺：'); for (const r of missing) log(`  ✗ ${r.relTarget}  (${r.status})`) }
    if (notPrepared.length) log(`\n另有 ${notPrepared.length} 个候选文件尚未准备（prepare 未跑到或被 --limit 截断），不计入问题。`)
    if (orphans.length) { log(''); log('孤儿（不在 map 里，服务应忽略）：'); for (const r of orphans) log(`  ? ${r}`) }
  }

  const problems = unreadable.length + mismatched.length + missing.length + orphans.length
  if (problems > 0) return 2
  return 0
}

// ---------------------------------------------------------------- thumbnail

/**
 * 缩略图落位约定（与服务端 server.mjs 的 THUMBNAIL_DIR 推导必须一致）：
 *
 *   --out 传的是**视频根目录**（不是 .thumbs 本身）。
 *   视频：  <out>/<relDir>/<name>.mp4
 *   缩略图：<out>/.thumbs/<relDir>/<name>.jpg     ← THUMBNAIL_DIR = <out>/.thumbs
 *
 * 也就是"视频名去掉扩展名 + .jpg，目录结构与视频完全镜像"。
 * 两边任何一边改了这条规则都会导致前端裂图，改动必须同步。
 */

/** 跑一次 ffmpeg，参数数组 + shell:false（文件名里有中文、空格、`】`、`／`）。 */
function runFfmpeg(args) {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-y', ...args], {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let err = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { if (err.length < 8192) err += chunk })
    child.on('error', (e) => resolve({ ok: false, code: 127, stderr: e.message }))
    child.on('close', (code) => resolve({ ok: code === 0, code, stderr: err.trim() }))
  })
}

/**
 * 探测这一帧里真正的画面区域（裁掉烧在源视频里的纯黑边）。
 *
 * 为什么需要：实测抽样发现约 2/3 的素材是"横版画面被 letterbox 进竖版画布"，
 * 黑边是**源视频像素**而不是缩略图管线加的。不裁掉就永远是一条细缝
 * （实测：只做 scale+pad 时，A 类素材的画面在 480×640 卡片里仍只占 19% 高）。
 *
 * 用 cropdetect（ffmpeg 内置）而不是自己算亮度：它逐行逐列找"连续接近纯黑"
 * 的边框，对暗部画面比全局阈值稳。找不到有效边框时返回 null，
 * 调用方就退化成"不裁剪、直接缩放补边"（B 类满幅录屏就走这条路）。
 *
 * 安全阀。cropdetect 的已知风险是把"本来就暗"的一帧误判成有黑边，
 * 一旦误判就会把人的脸裁掉，所以每一条都偏向"宁可少裁"：
 *   - 连续多帧的检测结果必须一致（cropdetect 收敛后才动手）
 *   - 裁剪区短边不得小于 64px（防止只剩一条缝）
 *   - 裁剪区不得小于源画面的 8%（再少就宁可保留黑边）
 *   - 裁剪后比例必须在 0.2 ~ 5 之间（极端长条判定误检）
 *   - 裁剪框必须落在源画面内（允许 2px 舍入误差）
 *   - ffmpeg 报错 / 没解析出 crop= 时返回 null，绝不猜
 *
 * 已知取舍：8% 这条线对本库最坏的一类素材（实测 A 类内容只占源画面 14.9%）
 * 仍然够用，但确实存在"极黑视频被裁得比预期多"的可能。
 * cropdetect 的 limit=24/255 已经很保守，真出问题也应该先调 limit 而不是调这条线。
 */
async function detectContentCrop(input, { seconds }) {
  const res = await new Promise((resolve) => {
    const args = [
      '-hide_banner', '-nostdin', '-loglevel', 'info',
      '-ss', String(Math.max(0, seconds ?? 0).toFixed(3)),
      '-i', input,
      '-frames:v', '5',
      '-vf', `cropdetect=round=2:limit=${THUMB_CROPDETECT_LIMIT}:reset=0`,
      '-f', 'null', '-',
    ]
    const child = spawn(FFMPEG, args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { if (err.length < 16384) err += chunk })
    child.on('error', () => resolve({ stderr: '' }))
    child.on('close', () => resolve({ stderr: err }))
  })
  // cropdetect 每帧都可能报一次；只看最后两帧，一致才算收敛
  const matches = [...res.stderr.matchAll(/crop=(\d+):(\d+):(-?\d+):(-?\d+)/g)]
    .map((m) => ({ w: Number(m[1]), h: Number(m[2]), x: Number(m[3]), y: Number(m[4]) }))
  if (matches.length < 2) return null
  const last = matches[matches.length - 1]
  const prev = matches[matches.length - 2]
  if (last.w !== prev.w || last.h !== prev.h || last.x !== prev.x || last.y !== prev.y) return null

  const { w, h, x, y } = last
  if (!(w > 0 && h > 0)) return null
  const info = await probeFile(input)
  if (!info.ok || !info.width || !info.height) return null
  if (w >= info.width && h >= info.height) return null // 没检测到黑边
  if (Math.min(w, h) < 64) return null // 只剩一条缝，判定误检
  if (w * h < info.width * info.height * 0.08) return null // 裁得太狠，判定误检
  const ratio = w / h
  if (ratio < 0.2 || ratio > 5) return null // 极端长条，判定误检
  if (x < -2 || y < -2 || x + w > info.width + 2 || y + h > info.height + 2) return null
  return { w, h, x, y }
}

/** 生成一张 480×640 的缩略图；返回 {ok, code, stderr, cropped}。 */
async function renderThumbnail(input, output, { seconds }) {
  const crop = await detectContentCrop(input, { seconds })
  const filter = crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},${THUMB_FILTER}` : THUMB_FILTER
  const res = await runFfmpeg([
    '-loglevel', 'error',
    '-ss', String(Math.max(0, seconds ?? 0).toFixed(3)),
    '-i', input,
    '-frames:v', '1',
    '-vf', filter,
    '-q:v', '4',
    output,
  ])
  return { ...res, cropped: Boolean(crop), crop: crop ?? null }
}

/**
 * 校验产出的缩略图尺寸确实是 240×320。
 * 尺寸不对就是失败 —— 宁可报 failed，也不要静默产出一张前端会裁坏的图。
 *
 * 为什么不用 probeFile（ffprobe）：图片本来就没有 duration。实测 ffmpeg ≥9 的
 * 单帧 JPEG 输出被识别为 `format_name=jpeg_pipe`、`duration=N/A`，而 probeFile
 * 把「无 duration」判成 `ok:false`，于是 100% 报「缩略图不可解析: duration 缺失或为 0」，
 * 一张图都产不出来。验图片必须走图片的路子：直接读 JPEG SOF 头里的宽高。
 *
 * 只在"新渲染了一张"时调用，不是每张都调。
 */
async function validateThumbSize(file) {
  const size = await readJpegSize(file)
  if (size === null) return { ok: false, error: '缩略图不可解析：读不出 JPEG 尺寸（文件损坏或不是 JPEG）' }
  if (size.width !== THUMB_WIDTH || size.height !== THUMB_HEIGHT) {
    return { ok: false, error: `尺寸不是 ${THUMB_WIDTH}×${THUMB_HEIGHT}，实际 ${size.width}×${size.height}` }
  }
  return { ok: true, width: size.width, height: size.height }
}

/**
 * 直接从 JPEG 头读出宽高，判"这张现成的图尺寸对不对"。
 *
 * 为什么不用 ffprobe：判重只需要宽高，而在本机实测**一次 ffprobe 要 1.0 秒**
 * （机器上同时跑着 prepare 的 5 路转码，CPU 被吃满）。266 张图各探一次就是
 * 几分钟的纯等待，而答案只是两个整数。读 JPEG 的 SOF 标记是微秒级的事。
 *
 * 读不出就返回 null，调用方一律当作"尺寸不对"→ 重画。
 * 这个方向是安全的：宁可多渲染一张，也绝不因为"读不出"就放过一张 480×640 的旧图
 * —— 那正是本次白屏事故的元凶。
 *
 * 只支持 JPEG（SOF0/1/2/…），因为本工具产出的缩略图和图库封面都是 jpg。
 * 遇到别的格式返回 null，走重画。
 */
async function readJpegSize(file) {
  let handle
  try {
    handle = await open(file, 'r')
    const { size } = await handle.stat()
    // SOF 通常在 JFIF/Exif 头之后几百字节内；256 KiB 足够覆盖带 Exif 缩略图的图。
    const want = Math.min(size, 256 * 1024)
    const buf = Buffer.alloc(want)
    const { bytesRead } = await handle.read(buf, 0, want, 0)
    return parseJpegSize(buf.subarray(0, bytesRead))
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}

/** 在 JPEG 字节流里找 SOF 标记并读出高/宽。纯函数，方便单测。 */
function parseJpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null // 没有 SOI
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue }
    const marker = buf[i + 1]
    // 填充字节：连续的 0xff
    if (marker === 0xff) { i += 1; continue }
    // 无参数段：SOI/EOI/RSTn/TEM
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue }
    const segLen = buf.readUInt16BE(i + 2)
    if (segLen < 2) return null
    // SOF0..SOF15，排除 DHT(C4) / JPG(C8) / DAC(CC)
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      if (i + 9 >= buf.length) return null
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    }
    i += 2 + segLen
  }
  return null
}

/** 判重用的宽松版：只问"这张现成的图是不是已经是目标画布"。 */
async function hasCurrentThumbSize(file) {
  const size = await readJpegSize(file)
  return size !== null && size.width === THUMB_WIDTH && size.height === THUMB_HEIGHT
}

async function cmdThumbnail(parsed) {
  const outDir = flagStr(parsed, 'out') ? path.resolve(flagStr(parsed, 'out')) : resolveOutDir(parsed)
  const reportDir = resolveReportDir(parsed, outDir)
  const force = Boolean(flag(parsed, 'force'))
  const dryRun = Boolean(flag(parsed, 'dry-run'))
  const asJson = Boolean(flag(parsed, 'json'))
  const concurrency = intFlag(parsed, 'concurrency', 4)

  if (!existsSync(outDir)) throw new FatalError(`目标目录不存在：${outDir}（先跑 prepare）`, 'NO_OUTPUT_DIR')

  const thumbRoot = resolveThumbDir(parsed, outDir)
  const mapPath = path.join(reportDir, 'video-map.json')
  let map = null
  if (existsSync(mapPath)) map = JSON.parse(await readFile(mapPath, 'utf8'))
  const mapByTarget = new Map((map?.entries ?? []).map((e) => [e.relTarget, e]))

  const files = await listTargetVideos(outDir)
  const results = []
  let stale = 0
  await pool(files, concurrency, async (f) => {
    // 视频已经在目标目录里，路径已是转义后的安全形态，所以只换扩展名，不再二次转义
    // （二次转义会把 `~hhhh~` 里的 `~` 再转一遍，得到错误路径）
    const segments = f.relPath.split('/')
    const base = segments[segments.length - 1]
    const { stem } = splitExtension(base)
    const dir = segments.slice(0, -1).join('/')
    const relThumb = dir ? `${dir}/${stem}.jpg` : `${stem}.jpg`
    const absThumb = path.join(thumbRoot, relThumb)
    const entry = mapByTarget.get(f.relPath)
    if (entry?.relThumb && entry.relThumb !== relThumb) {
      results.push({ relTarget: f.relPath, status: 'failed', error: `与 video-map 的 relThumb 不一致（${entry.relThumb} vs ${relThumb}）` })
      return
    }

    const vst = await stat(f.absPath)
    if (!force && existsSync(absThumb)) {
      const tst = await stat(absThumb)
      if (tst.mtimeMs >= vst.mtimeMs) {
        // 尺寸也要对：改了滤镜（输出从 480×640 降到 240×320）之后，
        // 旧图的 mtime 仍然比视频新，光看时间戳会把过期图当成"已是最新"跳过。
        // 这里额外校验一次尺寸，不匹配就重画 —— 不需要用户记得加 --force。
        // 判重走 readJpegSize 而不是 ffprobe：本机实测一次 ffprobe 要 1 秒，
        // 266 张各探一次就是几分钟的纯等待，而这里只需要两个整数。
        if (await hasCurrentThumbSize(absThumb)) {
          results.push({ relTarget: f.relPath, relThumb, status: 'skipped', reason: '已有且不旧于源视频' })
          return
        }
        stale += 1 // 尺寸不对（旧滤镜的产物），落到下面重画
      } else {
        stale += 1
      }
    }
    if (dryRun) {
      results.push({ relTarget: f.relPath, relThumb, status: 'would-render', reason: force ? 'force' : '缺失/过期/尺寸不符' })
      return
    }

    const info = await probeFile(f.absPath)
    if (!info.ok) {
      results.push({ relTarget: f.relPath, relThumb, status: 'failed', error: `视频不可解析: ${info.error}` })
      return
    }
    await mkdir(path.dirname(absThumb), { recursive: true })
    const part = `${absThumb}.part.jpg`
    // -ss 落在 15% 处：避开片头黑场/标题，也不碰片尾
    const res = await renderThumbnail(f.absPath, part, { seconds: info.duration * 0.15 })
    if (!res.ok) {
      await unlink(part).catch(() => {})
      results.push({ relTarget: f.relPath, relThumb, status: 'failed', error: `ffmpeg 退出码 ${res.code}: ${res.stderr || '(无 stderr)'}` })
      return
    }
    // 尺寸校验：不对就当失败，绝不把一张前端会裁坏的图 rename 到正式位置
    const size = await validateThumbSize(part)
    if (!size.ok) {
      await unlink(part).catch(() => {})
      results.push({ relTarget: f.relPath, relThumb, status: 'failed', error: size.error })
      return
    }
    await rename(part, absThumb)
    results.push({
      relTarget: f.relPath,
      relThumb,
      status: 'rendered',
      width: size.width,
      height: size.height,
      // 裁掉源视频里烧死的黑边（cropdetect）时才为 true
      letterboxCropped: res.cropped,
      crop: res.crop,
    })
  })

  results.sort((a, b) => a.relTarget.localeCompare(b.relTarget, 'zh-Hans-CN'))
  const counts = {
    total: results.length,
    rendered: results.filter((r) => r.status === 'rendered').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
    wouldRender: results.filter((r) => r.status === 'would-render').length,
    // 裁掉源视频里烧死的黑边才算真的解决了 letterbox 问题
    letterboxCropped: results.filter((r) => r.letterboxCropped).length,
    // 已有图但被判为过期/尺寸不符而重画的张数（改了滤镜之后这批会很大，属正常）
    staleRedrawn: stale,
  }
  const report = {
    tool: 'prepare-videos thumbnail',
    outputDir: outDir,
    // 交付要点：服务端 THUMBNAIL_DIR 必须等于这个值
    thumbnailDir: thumbRoot,
    rule: 'THUMBNAIL_DIR 指向一个目录；内部按视频相对路径镜像，文件名 = 视频名去扩展名 + .jpg',
    // 画布契约：必须与 src/index.css 的 .video-card__thumb（aspect-ratio: 3/4、
    // background: #1d2a45）一致，两边改一处就要同步另一处
    canvas: {
      width: THUMB_WIDTH,
      height: THUMB_HEIGHT,
      aspectRatio: `${THUMB_WIDTH} / ${THUMB_HEIGHT}`,
      padColor: `#${THUMB_PAD_COLOR}`,
      matchesCss: '.video-card__thumb { aspect-ratio: 3 / 4; background: #1d2a45 }',
    },
    filter: THUMB_FILTER,
    // 逐文件动态前置的裁剪段：cropdetect 探测源视频里烧死的纯黑边
    letterboxCrop: 'cropdetect=round=2:limit=24:reset=0（无黑边时自动退化为不裁）',
    dryRun,
    force,
    counts,
    results,
  }
  if (!dryRun) await writeJsonAtomic(path.join(reportDir, 'thumbnail-report.json'), report)

  if (asJson) log(JSON.stringify(report, null, 2))
  else {
    log('')
    log(`视频根目录  ${outDir}`)
    log(`缩略图目录  ${thumbRoot}   ← 服务端 THUMBNAIL_DIR 指这里`)
    log(`画布        ${THUMB_WIDTH}×${THUMB_HEIGHT}（3:4，与 .video-card__thumb 一致）　补边色 #${THUMB_PAD_COLOR}`)
    log(`滤镜        ${THUMB_FILTER}`)
    log(`共 ${counts.total}　新生成 ${counts.rendered}　跳过 ${counts.skipped}　失败 ${counts.failed}　其中裁掉源黑边 ${counts.letterboxCropped}　重画过期/尺寸不符 ${counts.staleRedrawn}${dryRun ? `　待生成 ${counts.wouldRender}` : ''}`)
    for (const r of results.filter((x) => x.status === 'failed')) log(`  ✗ ${r.relTarget}  ${r.error}`)
  }
  return counts.failed > 0 ? 2 : 0
}

// ---------------------------------------------------------------- covers

/**
 * 用户封面图库。
 *
 * **只读**。用户可能还在往这个目录里拷图，所以本命令对它只做 stat/readdir，
 * 一个字节都不写、也不改名、不删除（启动/结束都不会做快照比对 —— 只读目录
 * 就算被外部改动也是允许的，那是用户在补图，不是本命令的错）。
 */
async function listCoverImages(coversDir) {
  const out = []
  async function walk(relDir) {
    const abs = relDir ? path.join(coversDir, relDir) : coversDir
    let entries
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      // 隐藏文件（.DS_Store 的伴生 `._xxx`）直接跳过：它们是 0 字节元数据，
      // 送进 ffmpeg 只会得到一条没有意义的失败记录。
      if (entry.name.startsWith('.')) continue
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(rel)
      else if (entry.isFile() && COVER_IMAGE_EXT_RE.test(entry.name)) {
        out.push({ relPath: rel, absPath: path.join(coversDir, rel) })
      }
    }
  }
  await walk('')
  out.sort((a, b) => a.relPath.localeCompare(b.relPath, 'zh-Hans-CN'))
  return out
}

/**
 * 图库里的封面 → 播放目录里的视频相对路径；命中不了就返回 null。
 *
 * 关键：图库是**源目录形态**（未转义，文件名里是全角 `／`），而播放目录是
 * **转义后的部署形态**（`~ff0f~`）。两边要按 `vid-paths.mjs` 的同一套规则对齐，
 * 否则一张都对不上。所以这里逐段复用 `sanitizeSegment`，与 `targetRelativePath`
 * 保持一致 —— 复制一份实现就是复制同类事故的温床。
 *
 * 扩展名换成 .mp4：图库和视频靠**同名**配对，不靠扩展名。
 *
 * 重名兜底走 `uniqueTarget`（与 prepare 同一套 `~d1~` 规则）：源目录里两个文件
 * sanitize 后撞名时，prepare 给第二个加了 `~d1~`，图库里也有一张同名图，
 * 所以它必须能落到 `~d1~` 上，否则那张图会被判成"对不上"。
 *
 * @param {string} coverRelPath 图库内相对路径
 * @param {Set<string>} videoSet 播放目录里真实存在的视频相对路径
 * @param {Set<string>} claimed 已被前面几张图认领的视频（防一张图抢两次）
 */
function coverToVideoRelativePath(coverRelPath, videoSet, claimed) {
  const parts = coverRelPath.split('/')
  const { stem } = splitExtension(parts[parts.length - 1])
  const dirs = parts.slice(0, -1).map(sanitizeSegment)
  const base = `${sanitizeSegment(stem)}.mp4`
  const direct = dirs.length > 0 ? `${dirs.join('/')}/${base}` : base
  if (videoSet.has(direct) && !claimed.has(direct)) {
    claimed.add(direct)
    return direct
  }
  // direct 撞名（已认领或本身不是视频）时按 ~d1~、~d2~ 依次找第一个空位
  const fallback = uniqueTarget(direct, claimed)
  if (!videoSet.has(fallback) || claimed.has(fallback)) return null
  claimed.add(fallback)
  return fallback
}

/**
 * 把用户封面图库接进旁车缩略图目录。
 *
 * 封面来源优先级（本函数是 ①，前端占位块是 ③，中间由 thumbnail 子命令负责 ②）：
 *   ① 图库里的用户封面  ← 本命令，最高优先级，用户自己挑的/截的
 *   ② 视频抽帧生成的封面  ← `prepare-videos.mjs thumbnail`
 *   ③ 都没有              ← 前端 .video-card__placeholder 占位块
 * 之所以让图库压过抽帧：抽帧取的是 15% 处的帧，经常正好落在片头黑场或
 * 教练还没入镜的过渡帧上；图库是用户自己截的那一帧，一定是想要的那张。
 * 用户明确要求「务必每个视频都有封面」，而图库还在补全中（实测 18 个目录有图、
 * 视频有 52+ 个目录），所以对不上号的视频**绝不能报错** —— 保留 thumbnail
 * 子命令已经抽好的帧抽封面，一张都别退化成占位块。
 *
 * 因此调用顺序必须是先 `thumbnail` 再 `covers`：covers 只对**有图库封面**的
 * 视频动手，没有图库封面的视频它一个字都不写。
 */
async function cmdCovers(parsed) {
  const outDir = resolveOutDir(parsed)
  const reportDir = resolveReportDir(parsed, outDir)
  const force = Boolean(flag(parsed, 'force'))
  const dryRun = Boolean(flag(parsed, 'dry-run'))
  const asJson = Boolean(flag(parsed, 'json'))
  const concurrency = intFlag(parsed, 'concurrency', 4)

  const coversRaw = flagStr(parsed, 'covers') || process.env.COVER_LIBRARY_DIR
  if (!coversRaw) {
    throw new FatalError(
      '未指定封面图库目录。请传 --covers <DIR> 或设置环境变量 COVER_LIBRARY_DIR。',
      'NO_COVERS_DIR',
    )
  }
  const coversDir = path.resolve(coversRaw)
  if (!existsSync(coversDir)) throw new FatalError(`封面图库目录不存在：${coversDir}`, 'NO_COVERS_DIR')
  if (!existsSync(outDir)) throw new FatalError(`目标目录不存在：${outDir}（先跑 prepare）`, 'NO_OUTPUT_DIR')

  const thumbRoot = resolveThumbDir(parsed, outDir)
  const videos = await listTargetVideos(outDir)
  const videoSet = new Set(videos.map((v) => v.relPath))
  // claimed 只装"已经被某张图认领的视频"，与 videoSet 分开：
  // 把 videoSet 整个灌进 claimed 会让 uniqueTarget 把每一张图都推成 ~d1~（实测踩过）。
  const claimed = new Set()
  const coverFiles = await listCoverImages(coversDir)

  // 待办队列与结果数组必须分开：pool 按 index 遍历入参，而 worker 往 results 里
  // push —— 同一个数组会让 pool 遍历一个不断变长的列表，进程永远不退出（实测踩过）。
  const pending = []
  const unmatchedCovers = []
  for (const cover of coverFiles) {
    const relTarget = coverToVideoRelativePath(cover.relPath, videoSet, claimed)
    if (relTarget === null) {
      // 图库里多出来的图（视频还没拷进来 / 已改名）。报告出来让人能核对，
      // 但**绝不算失败** —— 图库天然可以比视频目录多。
      unmatchedCovers.push({ coverRel: cover.relPath })
      continue
    }
    pending.push({ relTarget, relCover: cover.relPath, absCover: cover.absPath })
  }

  // 反向：没有图库封面的视频 —— 它们依赖 ② 抽帧（由 thumbnail 子命令负责）
  const coveredTargets = new Set(pending.map((r) => r.relTarget))
  const withoutLibraryCover = videos
    .filter((v) => !coveredTargets.has(v.relPath))
    .map((v) => v.relPath)

  const results = []
  let rendered = 0
  let skipped = 0
  let failed = 0
  let wouldRender = 0

  await pool(pending, concurrency, async (item) => {
    const segments = item.relTarget.split('/')
    const { stem } = splitExtension(segments[segments.length - 1])
    const dir = segments.slice(0, -1).join('/')
    const relThumb = dir ? `${dir}/${stem}.jpg` : `${stem}.jpg`
    const absThumb = path.join(thumbRoot, relThumb)
    const base = { relTarget: item.relTarget, relThumb, relCover: item.relCover }

    if (!force && existsSync(absThumb)) {
      const [tst, cst, isCurrent] = await Promise.all([
        stat(absThumb).catch(() => null),
        stat(item.absCover).catch(() => null),
        hasCurrentThumbSize(absThumb),
      ])
      // 尺寸必须对：图库刚接进来时盘上是 480×640 的抽帧图，mtime 比图库新得多，
      // 只看时间戳会把过期的 480×640 当成"已是最新"跳过 —— 那正是白屏事故的元凶。
      // 两个条件都要过：比图库新 **且** 尺寸正好 240×320。
      if (isCurrent && cst !== null && tst !== null && tst.mtimeMs >= cst.mtimeMs) {
        skipped += 1
        results.push({ ...base, status: 'skipped', reason: `已是 ${THUMB_WIDTH}×${THUMB_HEIGHT} 且不旧于图库源图` })
        return
      }
    }
    if (dryRun) {
      wouldRender += 1
      results.push({ ...base, status: 'would-render' })
      return
    }

    const part = `${absThumb}.part.jpg`
    const res = await runFfmpeg([
      '-loglevel', 'error',
      '-i', item.absCover,
      '-frames:v', '1',
      '-vf', COVER_FILTER,
      '-q:v', '3',
      part,
    ])
    if (!res.ok) {
      await unlink(part).catch(() => {})
      failed += 1
      results.push({ ...base, status: 'failed', error: `ffmpeg 退出码 ${res.code}: ${res.stderr || '(无 stderr)'}` })
      return
    }
    // 尺寸校验：不对就当失败，绝不把一张前端会裁坏的图 rename 到正式位置
    const size = await validateThumbSize(part)
    if (!size.ok) {
      await unlink(part).catch(() => {})
      failed += 1
      results.push({ ...base, status: 'failed', error: size.error })
      return
    }
    await mkdir(path.dirname(absThumb), { recursive: true })
    await rename(part, absThumb)
    rendered += 1
    results.push({ ...base, status: 'rendered', width: size.width, height: size.height, source: 'library' })
  })

  results.sort((a, b) => a.relTarget.localeCompare(b.relTarget, 'zh-Hans-CN'))
  const counts = {
    videos: videos.length,
    libraryImages: coverFiles.length,
    libraryMatched: results.length,
    rendered,
    skipped,
    failed,
    wouldRender,
    unmatchedCovers: unmatchedCovers.length,
    videosWithoutLibraryCover: withoutLibraryCover.length,
  }
  const report = {
    tool: 'prepare-videos covers',
    coverLibrary: coversDir,
    coverLibraryReadOnly: true,
    outputDir: outDir,
    thumbnailDir: thumbRoot,
    // 交付要点：服务端 THUMBNAIL_DIR 必须等于这个值
    priority: '① 图库用户封面（本命令） > ② 视频抽帧（thumbnail 子命令） > ③ 前端占位块',
    canvas: {
      width: THUMB_WIDTH,
      height: THUMB_HEIGHT,
      aspectRatio: `${THUMB_WIDTH} / ${THUMB_HEIGHT}`,
      matchesCss: '.video-card__thumb { aspect-ratio: 3 / 4; background: #1d2a45 }',
    },
    filter: COVER_FILTER,
    // 画布从 480×640 降到 240×320：真机 3x 密度、MemFree 仅 123 MB，
    // Chrome 渲染进程反复被 OOM 杀导致白屏。解码内存 = 宽×高×4 字节。
    decodeBudget: {
      bytesPerImage: THUMB_WIDTH * THUMB_HEIGHT * 4,
      mibPerImage: (THUMB_WIDTH * THUMB_HEIGHT * 4) / 1024 / 1024,
      note: '240×320 → 0.293 MiB/张；266 张全量常驻约 76 MiB，低于 100 MB 白屏预算',
    },
    dryRun,
    force,
    counts,
    results,
    unmatchedCovers,
    videosWithoutLibraryCover: withoutLibraryCover,
  }
  if (!dryRun) await writeJsonAtomic(path.join(reportDir, 'covers-report.json'), report)

  if (asJson) log(JSON.stringify(report, null, 2))
  else {
    log('')
    log(`视频根目录    ${outDir}`)
    log(`封面图库      ${coversDir}   ← 只读，本命令不写不改不删`)
    log(`缩略图目录    ${thumbRoot}   ← 服务端 THUMBNAIL_DIR 指这里`)
    log(`画布          ${THUMB_WIDTH}×${THUMB_HEIGHT}（3:4，与 .video-card__thumb 一致）`)
    log(`滤镜          ${COVER_FILTER}（裁切填满）`)
    log('')
    log(`视频 ${counts.videos}　图库图片 ${counts.libraryImages}　配对成功 ${counts.libraryMatched}`)
    log(`  导入 ${rendered}　跳过 ${skipped}　失败 ${failed}${dryRun ? `　待导入 ${wouldRender}` : ''}`)
    log(`  图库里暂时对不上视频的图 ${unmatchedCovers.length}（视频还没拷进来或已改名，不算失败）`)
    log(`  没有图库封面的视频 ${withoutLibraryCover.length} → 由 thumbnail 子命令的抽帧封面兜底（②）`)
    for (const r of results.filter((x) => x.status === 'failed')) log(`  ✗ ${r.relTarget}  ${r.error}`)
    if (unmatchedCovers.length > 0) {
      log('')
      log('  对不上的图（前 10 个，完整清单见 covers-report.json）：')
      for (const u of unmatchedCovers.slice(0, 10)) log(`    ${u.coverRel}  →  ${u.relTarget}`)
    }
  }
  return failed > 0 ? 2 : 0
}

// ---------------------------------------------------------------- cache

/**
 * 列出「服务端会看到的」播放文件。
 *
 * 判定规则逐条对齐 `server/catalog-scan.mjs`：
 *   - 文件名过滤用服务端的 `isVideoFileName`（同样排掉 `.part.` / `.tmp.` / 隐藏文件 / `~$` / `._`）；
 *   - 相对路径用服务端的 `relativePosix`（realpath 后的根目录 + `normalizeRelativePath`）；
 *   - 符号链接只跟到根目录之内，越界就跳过（和服务端同一条安全规则）；
 *   - 0 字节文件跳过（服务端会记 unreadable 诊断，不进视频列表）。
 *
 * 为什么要抄这一整套而不是简单 `find *.mp4`：缓存的键必须与 `/api/videos` 的 relativePath
 * **逐字一致**。只要这里的收录规则与服务端有一处不同，命中率就会悄悄少一条 ——
 * 少的那一条在网页上就是「暂不可播放」+ 时长「—」，而容器依然 healthy。
 */
async function listPlaybackVideos(videosDir) {
  const requestedRoot = path.resolve(videosDir)
  // 与服务端一致：先 realpath 再算相对路径。macOS 上 /tmp、/var 都是符号链接，
  // 拿未 realpath 的路径算相对路径会得到 `../..` 这种服务端永远给不出的键。
  const rootResolved = path.resolve(await realpath(requestedRoot))
  const rootPrefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep
  const insideRoot = (candidate) => candidate === rootResolved || candidate.startsWith(rootPrefix)

  const out = []
  const skipped = []
  const queue = [rootResolved]
  const visitedRealDirs = new Set([rootResolved])

  while (queue.length > 0) {
    const dir = queue.shift()
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (err) {
      skipped.push({ relPath: relativePosix(rootResolved, dir) || '.', reason: `目录不可读: ${err.message}` })
      continue
    }
    for (const entry of entries) {
      const listedPath = path.join(dir, entry.name)
      const rel = relativePosix(rootResolved, listedPath)
      let targetPath = listedPath
      let isDirectory = entry.isDirectory()
      let isFile = entry.isFile()

      if (entry.isSymbolicLink()) {
        const real = await realpath(listedPath).catch(() => null)
        if (real === null) {
          skipped.push({ relPath: rel, reason: '符号链接目标不存在' })
          continue
        }
        if (!insideRoot(path.resolve(real))) {
          skipped.push({ relPath: rel, reason: '符号链接指向播放文件根目录之外' })
          continue
        }
        targetPath = path.resolve(real)
        const targetStat = await stat(targetPath).catch(() => null)
        if (targetStat === null) {
          skipped.push({ relPath: rel, reason: '无法读取符号链接目标信息' })
          continue
        }
        isDirectory = targetStat.isDirectory()
        isFile = targetStat.isFile()
      }

      const finalPath = path.resolve(targetPath)
      if (!insideRoot(finalPath)) {
        skipped.push({ relPath: rel, reason: '路径逃出播放文件根目录' })
        continue
      }
      if (isDirectory) {
        const real = await realpath(finalPath).catch(() => null)
        if (real === null || visitedRealDirs.has(real)) continue
        visitedRealDirs.add(real)
        queue.push(real)
        continue
      }
      if (!isFile) continue
      // 文件名规则以服务端为准：它排掉的，这里也排掉（`.part.` 中缀尤其重要，
      // 那是转码中间产物，进了缓存就是一条 available:false 的假视频）。
      if (!isVideoFileName(entry.name)) {
        if (path.extname(entry.name).toLowerCase() === '.mp4') {
          skipped.push({ relPath: rel, reason: '服务端扫描规则也会排除它（.part. / .tmp. / 隐藏文件等）' })
        }
        continue
      }
      const st = await stat(finalPath).catch(() => null)
      if (st === null || !st.isFile() || st.size === 0) {
        skipped.push({ relPath: rel, reason: '文件为空或不可 stat，服务端也会跳过' })
        continue
      }
      out.push({ relPath: rel, absPath: finalPath, size: st.size, mtimeMs: st.mtimeMs })
    }
  }

  // 与服务端一致：按码位排序，保证输出稳定可对拍。
  out.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))
  skipped.sort((a, b) => a.relPath.localeCompare(b.relPath, 'zh-Hans-CN'))
  return { root: rootResolved, files: out, skipped }
}

/** 读旧缓存，坏 JSON 当空对象（重跑一次就能修好，不该在这里直接崩掉）。 */
async function readExistingCache(file) {
  if (!existsSync(file)) return { data: {}, broken: false }
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { data: parsed, broken: false }
    return { data: {}, broken: true }
  } catch {
    return { data: {}, broken: true }
  }
}

/** 旧条目里的时长。兼容裸数字和 {durationSeconds} 两种写法。 */
function existingSeconds(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value && typeof value === 'object') {
    const n = value.durationSeconds
    return typeof n === 'number' && Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * cache：在宿主机上预生成服务端要的 `catalog-cache.json`。
 *
 * 存在的唯一理由（2026-09-28 线上事故）：容器镜像里**没有 ffprobe**，
 * 而 `catalog` 又是 `:ro` 只读挂载（容器还 `read_only: true`），
 * 于是 `server/duration-probe.mjs` 的后台补缓存两条路都走不通 ——
 * 130 个视频全部 `available:false`、时长 0，容器却一直 healthy。
 * 正确解法是把时长在宿主机上量好，随部署一起挂进去；容器只读即可用。
 *
 * 可重跑：默认仍然实测每个文件，但**已有值与实测一致（在 DURATION_TOLERANCE 内）
 * 就原样保留**，所以重复跑不会让文件无意义地抖动；`--force` 才一律以实测覆盖。
 * 输出恒为「当前扫描到的全集」：旧缓存里已不存在的键会被清掉（它们服务端永远查不到，
 * 留着只会让人误以为命中率高），清掉的数量会明确报出来。
 */
async function cmdCache(parsed) {
  const videosRaw = flagStr(parsed, 'videos')
  if (!videosRaw) {
    throw new FatalError(
      '未指定播放文件根目录。请传 --videos <DIR>（必须是服务端 VIDEO_ROOT 挂进去的那个目录，键就是相对它的路径）。',
      'NO_VIDEOS_DIR',
    )
  }
  const catalogRaw = flagStr(parsed, 'out')
  if (!catalogRaw) {
    throw new FatalError(
      '未指定标注目录。请传 --out <DIR>，缓存会写到 <DIR>/catalog-cache.json。',
      'NO_CATALOG_DIR',
    )
  }
  const videosDir = path.resolve(videosRaw)
  const catalogDir = path.resolve(catalogRaw)
  const force = Boolean(flag(parsed, 'force'))
  const dryRun = Boolean(flag(parsed, 'dry-run'))
  const asJson = Boolean(flag(parsed, 'json'))
  const allowMissingAnnotations = Boolean(flag(parsed, 'allow-missing-annotations'))
  const concurrency = intFlag(parsed, 'concurrency', 8)

  if (!existsSync(videosDir)) throw new FatalError(`播放文件根目录不存在：${videosDir}`, 'NO_VIDEOS_DIR')
  if (!existsSync(catalogDir)) throw new FatalError(`标注目录不存在：${catalogDir}`, 'NO_CATALOG_DIR')

  // 守卫：服务端是从 ANNOTATIONS_FILE 推缓存路径的（server/duration-cache.mjs 的
  // resolveCacheFile = 标注文件同级目录/catalog-cache.json）。所以 --out 传错目录时，
  // 我们会安安静静生成一个服务端永远读不到的文件 —— 这正是本次事故的同类故障
  // （「东西生成了，但就是没人用」）。默认直接拒绝，除非显式 --allow-missing-annotations。
  const annotationsPath = path.join(catalogDir, 'annotations.json')
  if (!existsSync(annotationsPath) && !allowMissingAnnotations) {
    throw new FatalError(
      `${catalogDir} 里没有 annotations.json。服务端的缓存路径是**从标注文件推出来的**，`
      + `--out 传错目录就会生成一个永远读不到的文件。\n`
      + `请把 --out 指向真正的标注目录，或确认无误后加 --allow-missing-annotations。`,
      'NO_ANNOTATIONS_IN_OUT',
    )
  }

  const cacheFile = path.join(catalogDir, CACHE_FILENAME)
  const { data: existing, broken: existingBroken } = await readExistingCache(cacheFile)
  const { root, files, skipped } = await listPlaybackVideos(videosDir)
  if (files.length === 0) {
    throw new FatalError(`播放文件根目录里一个视频都没有：${videosDir}`, 'NO_VIDEOS_FOUND')
  }

  const startedAt = Date.now()
  const results = []
  await pool(files, concurrency, async (f) => {
    const info = await probeFile(f.absPath)
    if (!info.ok) {
      results.push({ relPath: f.relPath, status: 'failed', error: info.error })
      return
    }
    if (!Number.isFinite(info.duration) || info.duration <= 0) {
      // 0 时长写进缓存 = 这条视频永远 available:false，比缺条目还糟（缺条目至少有诊断）。
      results.push({ relPath: f.relPath, status: 'failed', error: `实测时长不是正数：${info.duration}` })
      return
    }
    const previous = existingSeconds(existing[f.relPath])
    const sameAsMeasured = previous !== null && Math.abs(previous - info.duration) <= DURATION_TOLERANCE
    if (!force && sameAsMeasured) {
      results.push({ relPath: f.relPath, status: 'skipped', durationSeconds: previous, measuredSeconds: info.duration })
      return
    }
    results.push({
      relPath: f.relPath,
      status: force ? 'rewritten' : 'written',
      durationSeconds: info.duration,
      previousSeconds: previous,
    })
  })

  // 输出集合 = 本次扫描到的全集。旧缓存里已不存在的键（典型是 prepare 之前按
  // **源目录原名**写的那批，服务端拿部署态路径永远查不到）直接丢掉，避免命中率虚高。
  const scanned = new Set(files.map((f) => f.relPath))
  const dropped = Object.keys(existing).filter((key) => !scanned.has(normalizeRelativePath(key)))

  const next = {}
  let written = 0
  let skippedSame = 0
  for (const r of results) {
    if (r.status === 'failed') continue
    if (r.status === 'skipped') {
      // 原样保留旧条目（含其它字段），只把时长对齐到实测值。
      const base = existing[r.relPath]
      next[r.relPath] = { ...(base && typeof base === 'object' ? base : {}), durationSeconds: r.durationSeconds }
      skippedSame += 1
      continue
    }
    const base = existing[r.relPath]
    next[r.relPath] = { ...(base && typeof base === 'object' ? base : {}), durationSeconds: r.durationSeconds }
    written += 1
  }

  // 键按码位排序后再落盘：并发池的完成顺序是不确定的，直接用 results 的顺序会
  // 让每次重跑产出的文件键序都不同 —— 内容一模一样，diff 却显示全文件改动，
  // 部署产物因此无意义地抖动。排序规则与服务端扫描一致。
  const ordered = Object.keys(next).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const sorted = {}
  for (const key of ordered) sorted[key] = next[key]

  const failed = results.filter((r) => r.status === 'failed')
  const counts = {
    scanned: files.length,
    written: force ? written : written,
    unchanged: skippedSame,
    failed: failed.length,
    droppedStaleKeys: dropped.length,
    skippedByScanRules: skipped.length,
  }
  const elapsedMs = Date.now() - startedAt
  const report = {
    tool: 'prepare-videos cache',
    generatedAt: new Date().toISOString(),
    videosDir: root,
    catalogDir,
    // 服务端按 ANNOTATIONS_FILE 推出来的就是这个路径（见 docs/DEPLOY.md）
    cacheFile,
    cacheKeyRule: '键 = 相对播放文件根目录的路径（NFC 规范化、posix 分隔符），与服务端 /api/videos 的 relativePath 逐字一致',
    durationToleranceSeconds: DURATION_TOLERANCE,
    force,
    dryRun,
    concurrency,
    elapsedMs,
    counts,
    annotationsPresent: existsSync(annotationsPath),
    failedResults: failed.map((f) => ({ relPath: f.relPath, error: f.error })),
    skippedByScanRules: skipped,
    droppedStaleKeys: dropped,
    results: results.sort((a, b) => a.relPath.localeCompare(b.relPath, 'zh-Hans-CN')),
  }

  if (!dryRun) await writeJsonAtomic(cacheFile, sorted)

  if (asJson) log(JSON.stringify(report, null, 2))
  else {
    log('')
    log(`播放文件根目录  ${root}`)
    log(`缓存文件        ${cacheFile}${dryRun ? '   （--dry-run，未落盘）' : ''}`)
    log(`键规则          相对播放文件根目录，与 /api/videos 的 relativePath 逐字一致`)
    log(`共 ${counts.scanned}　写入 ${counts.written}　与实测一致原样保留 ${counts.unchanged}　失败 ${counts.failed}　清掉旧缓存里的失效键 ${counts.droppedStaleKeys}　按服务端规则跳过 ${counts.skippedByScanRules}　耗时 ${(elapsedMs / 1000).toFixed(1)}s`)
    if (existingBroken) log('注意：旧缓存不是合法 JSON，已按空缓存重建。')
    if (counts.droppedStaleKeys > 0) {
      log(`清掉的失效键（旧缓存里有、这次扫描不到，服务端永远查不到）：`)
      for (const key of dropped.slice(0, 20)) log(`  - ${key}`)
      if (dropped.length > 20) log(`  … 另有 ${dropped.length - 20} 条`)
    }
    for (const f of failed) log(`  ✗ ${f.relPath}  ${f.error}`)
    if (counts.failed > 0) {
      log('')
      log(`有 ${counts.failed} 个文件没能测出时长，它们在网页上会是「暂不可播放」。`)
    }
  }
  return counts.failed > 0 ? 2 : 0
}

// ---------------------------------------------------------------- 入口

const USAGE = `视频准备工具箱（源目录只读）

  node scripts/prepare-videos.mjs probe      [--src DIR] [--out DIR] [--mode copy|transcode|auto] [--deep] [--json]
  node scripts/prepare-videos.mjs prepare    [--src DIR] [--out DIR] [--mode copy|transcode|auto] [--limit N] [--force] [--concurrency N] [--dry-run] [--json]
  node scripts/prepare-videos.mjs verify     [--out DIR] [--src DIR] [--json]
  node scripts/prepare-videos.mjs thumbnail  --out DIR [--thumb-dir DIR] [--force] [--concurrency N] [--dry-run] [--json]
  node scripts/prepare-videos.mjs covers    --covers DIR [--out DIR] [--thumb-dir DIR] [--force] [--concurrency N] [--dry-run] [--json]
  node scripts/prepare-videos.mjs cache      --videos DIR --out DIR [--force] [--concurrency N] [--dry-run] [--json]

  --src  默认取环境变量 VIDEO_SOURCE_DIR；两者都没有就报错（不硬编码绝对路径）
  --out  默认取环境变量 VIDEO_OUTPUT_DIR，再默认 scripts/.out/videos
  --report-dir  运行产物目录（probe-report.* / video-map.json / prepare-state.json），
                默认是 --out 的上一级，即 scripts/.out/
  --json  机器可读输出
  --dry-run 只算不做
  --strict prepare 时把"源不可解析"计为失败（默认只跳过并记账）

缩略图落位：<视频相对路径去扩展名>.jpg，默认 <视频根>/.thumbs/，可用 --thumb-dir 改。
            ⚠️ --thumb-dir 必须与服务端 THUMBNAIL_DIR 指向同一目录。本机部署把它指向
               catalog/thumbnails，而不是 <视频根>/.thumbs —— 两处各有独立副本，
               只写默认位置会出现「命令跑成功但页面封面没变」。
缩略图画布：统一 240×320（3:4），与前端 .video-card__thumb 的 aspect-ratio: 3/4 严格一致。
            为什么不是 480×640：真机 3x 密度、MemFree 仅 123 MB，Chrome 渲染进程被反复 OOM
            杀导致白屏。Chrome 解码后常驻 宽×高×4 字节，与压缩率无关 ——
            480×640 是 1.23 MB/张（130 张 160 MB，故障态），240×320 是 0.31 MB/张
            （266 张 82 MB，低于 100 MB 预算）。详见 THUMB_WIDTH 处的完整测算。
            抽帧路径不足处用 #1d2a45（封面盒背景色）补齐，并先裁掉源视频里烧死的纯黑边。
            尺寸不匹配的旧图会被自动重画（旧图 mtime 比源文件新，也照样重画），不依赖 --force。

covers —— 把用户封面图库接进旁车缩略图目录，**必须在 thumbnail 之后跑**：
  node scripts/prepare-videos.mjs covers --covers <封面图库目录> --out <播放文件根目录>
  - 封面来源优先级：① 图库用户封面（本命令）> ② 视频抽帧（thumbnail 子命令）> ③ 前端占位块。
    图库压过抽帧，因为抽帧取 15% 处的帧经常落在片头黑场上，而图库是用户自己截的那一帧。
  - 配对规则：图库与视频**同名**（图库是源目录形态的未转义名，播放目录是 ~ff0f~ 转义后的
    部署名，本命令按 vid-paths.mjs 同一套 sanitizeSegment 规则对齐）。
  - 图库目录**严格只读**：不写、不改名、不删除（用户可能还在往里拷图）。
  - 图库里对不上视频的图（图库可以比视频目录多）不算失败，只在报告里列出。
  - 没有图库封面的视频本命令一个字都不写，保留 thumbnail 抽好的 ② 封面，一张都不会退化成占位块。
  - 同样按「尺寸必须是 240×320 且不旧于图库源图」判重，不依赖 --force 就能把旧的 480×640 换掉。

cache —— 部署前置步骤，**必须在宿主机上跑**（容器镜像里没有 ffprobe，catalog 又是只读挂载，
        服务端自己补不了时长缓存；缺了它，所有视频都会显示「暂不可播放」、时长显示「—」，
        而容器依然 healthy。详见 docs/DEPLOY.md）：
  node scripts/prepare-videos.mjs cache --videos <播放文件根目录> --out <标注目录>
  - --videos 必须是服务端 VIDEO_ROOT 挂进去的那个目录。缓存键 = 相对它的路径，
             与 GET /api/videos 返回的 relativePath 逐字一致（含 prepare 转义出的 ~ff0f~ 这类名字）。
  - --out   必须是标注目录（里面有 annotations.json）。服务端从 ANNOTATIONS_FILE 推缓存路径，
             传错目录就会生成一个永远读不到的文件，所以默认直接拒绝。
  - 实测每个 .mp4 的真实时长，写出 <标注目录>/catalog-cache.json（临时文件 + rename 原子落盘）。
  - 可重跑：已有值与实测一致（1.5 秒容差内）就原样保留；--force 才一律以实测覆盖。
  - 输出恒为本次扫描到的全集：旧缓存里已失效的键会被清掉，数量会明确报出来。
  - 退出码：0 全部成功 / 2 有文件测不出时长（会逐条列出）。
`

async function main() {
  const argv = process.argv.slice(2)
  const command = argv.find((a) => !a.startsWith('--'))
  if (!command || !COMMANDS.has(command)) {
    log(USAGE)
    return command ? 1 : 1
  }
  let parsed
  try {
    // 只摘掉第一个裸命令词，其余原样交给参数解析
    const rest = argv.slice()
    rest.splice(rest.indexOf(command), 1)
    parsed = parseArgs(rest)
    if (flag(parsed, 'help') || flag(parsed, 'h')) {
      log(USAGE)
      return 0
    }
    switch (command) {
      case 'probe': return await cmdProbe(parsed)
      case 'prepare': return await cmdPrepare(parsed)
      case 'verify': return await cmdVerify(parsed)
      case 'thumbnail': return await cmdThumbnail(parsed)
      case 'covers': return await cmdCovers(parsed)
      case 'cache': return await cmdCache(parsed)
      default: return 1
    }
  } catch (err) {
    if (err instanceof FatalError) {
      warn(`\n[${err.code}] ${err.message}`)
      return 1
    }
    warn(`\n[UNEXPECTED] ${err?.stack || err}`)
    return 1
  }
}

process.exitCode = await main()
