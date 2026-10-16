// 源目录扫描 + 统计聚合。
//
// 约束：源目录是**只读输入**。所以这里提供 snapshot()/compareSnapshot()，
// prepare 结束时用它证明"我们没有动过源目录"。

import { readdir, lstat } from 'node:fs/promises'
import path from 'node:path'

// 只接受这些扩展名；本任务实际命中的全是 .mp4
export const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov'])

/** 递归列出源目录下的候选视频（不跟随符号链接，避免绕出源目录）。 */
export async function listSourceVideos(srcDir) {
  const out = []
  async function walk(relDir) {
    const abs = relDir ? path.join(srcDir, relDir) : srcDir
    let entries
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch (err) {
      out.push({ relPath: relDir ? `${relDir}/` : '.', error: `目录不可读: ${err.message}` })
      return
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(rel)
      else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push({ relPath: rel })
    }
  }
  await walk('')
  out.sort((a, b) => (a.relPath || '').localeCompare(b.relPath || '', 'zh-Hans-CN'))
  return out
}

/**
 * 对源目录做一次 stat 快照（递归）。用于结束时核对 mtime/size/inode 未变。
 * 纯 stat，不读内容。
 */
export async function snapshotTree(root) {
  const snap = new Map()
  async function walk(relDir) {
    const abs = relDir ? path.join(root, relDir) : root
    let entries
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      const child = path.join(root, rel)
      let st
      try {
        st = await lstat(child)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        snap.set(rel, { type: 'dir', size: st.size, mtimeMs: st.mtimeMs, ino: st.ino })
        await walk(rel)
      } else {
        snap.set(rel, { type: 'file', size: st.size, mtimeMs: st.mtimeMs, ino: st.ino })
      }
    }
  }
  await walk('')
  return snap
}

/** 比对两份快照，返回差异列表（空数组 = 源目录没被改动）。 */
export function compareSnapshot(before, after) {
  const diffs = []
  for (const [rel, a] of before) {
    const b = after.get(rel)
    if (!b) { diffs.push({ rel, change: 'deleted' }); continue }
    if (b.size !== a.size || b.mtimeMs !== a.mtimeMs || b.ino !== a.ino) {
      diffs.push({ rel, change: 'modified', before: a, after: b })
    }
  }
  for (const rel of after.keys()) if (!before.has(rel)) diffs.push({ rel, change: 'created' })
  return diffs
}

const HOUR = 3600

/**
 * 疑似"同源同内容"分组：同目录 + 去掉 ` (n)` 副本后缀的文件名相同。
 * 只用名字分组，不看内容——因为 15 GB 全量 sha256 要几十分钟。
 */
export function groupBySiblingName(items) {
  const groups = new Map()
  for (const item of items) {
    if (!item.relPath) continue
    const slash = item.relPath.lastIndexOf('/')
    const dir = slash < 0 ? '' : item.relPath.slice(0, slash)
    const base = slash < 0 ? item.relPath : item.relPath.slice(slash + 1)
    const stem = base.replace(/\s*\(\d+\)(?=\.[^.]+$)/, '')
    // \u0000 不会出现在任何合法路径里，用它做分隔符，避免 dir 与 stem 的边界歧义
    const key = `${dir}\u0000${stem}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return groups
}

/** 时长直方图（分钟）。健身视频天然聚集在 3–20 分钟，用固定桶比 Freedman–Diaconis 更好读。 */
export function durationHistogram(durations) {
  const buckets = [
    { label: '<5m', min: 0, max: 300 },
    { label: '5–10m', min: 300, max: 600 },
    { label: '10–15m', min: 600, max: 900 },
    { label: '15–20m', min: 900, max: 1200 },
    { label: '20–30m', min: 1200, max: 1800 },
    { label: '30–45m', min: 1800, max: 2700 },
    { label: '≥45m', min: 2700, max: Infinity },
  ]
  return buckets.map((b) => ({
    ...b,
    max: b.max === Infinity ? null : b.max,
    count: durations.filter((d) => d >= b.min && (b.max === Infinity || d < b.max)).length,
  }))
}

export function stats(numbers) {
  if (numbers.length === 0) return { count: 0, min: null, max: null, median: null, mean: null }
  const sorted = [...numbers].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  }
}

export function tally(values) {
  const map = new Map()
  for (const v of values) {
    const key = v === null || v === undefined ? '(none)' : String(v)
    map.set(key, (map.get(key) || 0) + 1)
  }
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]))
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—'
  const s = Math.round(seconds)
  const h = Math.floor(s / HOUR)
  const m = Math.floor((s % HOUR) / 60)
  const sec = s % 60
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m${String(sec).padStart(2, '0')}s` : `${m}m${String(sec).padStart(2, '0')}s`
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1 }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 2)} ${units[i]}`
}
