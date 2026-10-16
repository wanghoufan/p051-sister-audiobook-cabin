// ffmpeg / ffprobe 封装。
//
// 全部走 child_process 的参数数组（shell: false）：源文件名里有中文、空格、`】`、
// `／`，任何 shell 字符串拼接都会在这些字符上炸掉或被注入。
// ffprobe 输出 JSON，ffmpeg 用 `-progress pipe:1` 吐 key=value 进度，避免解析人类可读日志。

import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

export const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg'
export const FFPROBE = process.env.FFPROBE_BIN || 'ffprobe'

/** 转码参数：任务书指定的基线。H.264 High + yuv420p 是安卓硬解最保险的组合。 */
export const TRANSCODE_ARGS = [
  '-c:v', 'libx264',
  '-profile:v', 'high',
  '-pix_fmt', 'yuv420p',
  '-preset', 'veryfast',
  '-crf', '24',
  '-c:a', 'aac',
  '-b:a', '128k',
  '-movflags', '+faststart',
]

/**
 * 显式 map：这些源文件除 HEVC 视频轨和 AAC 音频轨外，还挂了一条 mjpeg 封面轨。
 * 不显式 map 的话 `-c:v libx264` 会把封面也拿去编码，既慢又会破坏封面语义。
 */
export const MAP_ARGS = ['-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '0']

function run(cmd, args, { timeout = 0, maxBuffer = 32 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { shell: false, timeout, maxBuffer, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr, error: err })
    })
  })
}

/**
 * 读一个媒体文件的真实信息。绝不抛异常：解析不了就是解析不了，调用方要靠这个分类。
 * @returns {Promise<object>} 至少含 `ok`；成功时含 duration/codec/pixFmt/profile/size/width/height/bitRate/audioCodec
 */
export async function probeFile(file) {
  const res = await run(FFPROBE, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file,
  ], { timeout: 120000 })
  if (res.code !== 0) {
    return { ok: false, error: (res.stderr || res.error?.message || 'ffprobe failed').trim().split('\n')[0] }
  }
  let json
  try {
    json = JSON.parse(res.stdout)
  } catch (err) {
    return { ok: false, error: `ffprobe 输出不是合法 JSON: ${err.message}` }
  }
  const streams = Array.isArray(json.streams) ? json.streams : []
  const video = streams.find((s) => s.codec_type === 'video') || null
  const audio = streams.find((s) => s.codec_type === 'audio') || null
  const format = json.format || {}
  const duration = Number(format.duration ?? video?.duration ?? NaN)
  let size = Number(format.size ?? NaN)
  if (!Number.isFinite(size)) {
    try { size = (await stat(file)).size } catch { size = NaN }
  }
  if (!video) return { ok: false, error: '没有视频轨', duration: Number.isFinite(duration) ? duration : null, size }
  if (!Number.isFinite(duration) || duration <= 0) return { ok: false, error: 'duration 缺失或为 0', size }

  const frameRates = String(video.avg_frame_rate || video.r_frame_rate || '0/1').split('/')
  const fps = Number(frameRates[0]) / (Number(frameRates[1]) || 1)
  return {
    ok: true,
    duration,
    size,
    // Main 10 / yuv420p10le 之类的 profile 决定安卓能不能硬解，是本任务的核心风险点
    profile: video.profile ?? null,
    pixFmt: video.pix_fmt ?? null,
    bitDepth: bitDepthFromPixFmt(video.pix_fmt),
    codec: video.codec_name ?? null,
    width: video.width ?? null,
    height: video.height ?? null,
    fps: Number.isFinite(fps) && fps > 0 ? Number(fps.toFixed(3)) : null,
    bitRate: Number(video.bit_rate ?? format.bit_rate ?? NaN) || null,
    audioCodec: audio?.codec_name ?? null,
    audioChannels: audio?.channels ?? null,
    audioSampleRate: Number(audio?.sample_rate ?? NaN) || null,
    extraStreams: streams
      .filter((s) => !((s.codec_type === 'video' && s === video) || (s.codec_type === 'audio' && s === audio)))
      .map((s) => ({ type: s.codec_type, codec: s.codec_name })),
  }
}

function bitDepthFromPixFmt(pixFmt) {
  if (!pixFmt) return null
  const m = /p(\d+)(?:le|be)?$/.exec(pixFmt)
  if (m) return Number(m[1])
  if (pixFmt === 'yuv420p' || pixFmt === 'yuv422p' || pixFmt === 'yuv444p') return 8
  if (pixFmt.startsWith('gray') || pixFmt === 'yuvj420p') return 8
  return null
}

export function isTenBit(info) {
  return info?.bitDepth === 10 || /10le$|10be$/.test(String(info?.pixFmt || ''))
}

/**
 * 跑一次转码。`.part.mp4` 由调用方负责，成功后再原子 rename。
 * @param {(pct:number|null)=>void} [onProgress] 0..100
 * @returns {Promise<{ok:boolean, code:number, stderr:string}>}
 */
export async function transcode(input, output, { onProgress, extraArgs = [], durationSeconds } = {}) {
  // 进度百分比需要源时长；调用方（prepare）已经在 probe 阶段拿到了，这里就不再重复 ffprobe
  const seconds = durationSeconds ?? (await probeDuration(input))
  const totalUs = (seconds || 0) * 1e6
  return new Promise((resolve) => {
    const args = [
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
      '-i', input,
      ...MAP_ARGS,
      ...extraArgs,
      ...TRANSCODE_ARGS,
      // 进度走 stdout 的 key=value，不和日志混在一起
      '-progress', 'pipe:1', '-nostats',
      output,
    ]
    const child = spawn(FFMPEG, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let outBuf = ''
    let errBuf = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      outBuf += chunk
      let idx
      while ((idx = outBuf.indexOf('\n')) >= 0) {
        const line = outBuf.slice(0, idx)
        outBuf = outBuf.slice(idx + 1)
        const eq = line.indexOf('=')
        if (eq < 0) continue
        const key = line.slice(0, eq).trim()
        const value = line.slice(eq + 1).trim()
        if (key === 'out_time_us' && totalUs > 0 && onProgress) {
          const us = Number(value)
          // ffmpeg 收尾时会吐 out_time_us=N/A，必须挡掉，否则进度条出现 NaN%
          if (Number.isFinite(us)) onProgress(Math.min(100, (us / totalUs) * 100))
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c) => { if (errBuf.length < 8192) errBuf += c })
    child.on('error', (err) => resolve({ ok: false, code: 127, stderr: err.message }))
    child.on('close', (code) => {
      onProgress?.(100)
      resolve({ ok: code === 0, code, stderr: errBuf.trim() })
    })
  })
}

// 进度条需要源时长；调用方在 probe 阶段通常已经有，这里只做兜底。
export async function probeDuration(file) {
  const info = await probeFile(file)
  return info.ok ? info.duration : null
}

/**
 * 截一张缩略图。`-ss` 放在 `-i` 之前走关键帧快速定位，15 GB 全量不需要重解码。
 */
export function makeThumbnail(input, output, { seconds, onProgress } = {}) {
  return new Promise((resolve) => {
    const args = [
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
      '-ss', String(Math.max(0, seconds ?? 0).toFixed(3)),
      '-i', input,
      '-frames:v', '1',
      '-vf', 'scale=480:-2',
      '-q:v', '4',
      output,
    ]
    const child = spawn(FFMPEG, args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] })
    let errBuf = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c) => { if (errBuf.length < 4096) errBuf += c })
    child.on('error', (err) => resolve({ ok: false, code: 127, stderr: err.message }))
    child.on('close', (code) => resolve({ ok: code === 0, code, stderr: errBuf.trim() }))
    onProgress?.(1)
  })
}

/** 整文件 sha256。15 GB 全量很慢，只在 --deep 且同组疑似重复时调用。 */
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file, { highWaterMark: 4 * 1024 * 1024 })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export { run as _run }
