import type { Level } from './types'

const EM_DASH = '—'

function isUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 秒数转 mm:ss / h:mm:ss，用于时长筛选摘要与卡片。
 * 非法输入（负数、NaN、null、字符串）统一返回 '—'，绝不让页面因一个脏字段崩溃。
 */
export function formatDuration(seconds: unknown): string {
  if (!isUsableNumber(seconds) || seconds < 0) return EM_DASH
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * 秒数转「约 12 分钟」这类摘要文案；不足 1 分钟显示「不到 1 分钟」，避免出现「约 0 分钟」。
 */
export function formatMinutes(seconds: unknown): string {
  if (!isUsableNumber(seconds) || seconds < 0) return EM_DASH
  if (seconds < 60) return '不到 1 分钟'
  return `约 ${Math.round(seconds / 60)} 分钟`
}

/**
 * 字节数转可读体积，用于诊断列表里的「这个文件多大」；非法输入返回 '—'。
 */
export function formatBytes(bytes: unknown): string {
  if (!isUsableNumber(bytes) || bytes < 0) return EM_DASH
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`
}

/**
 * 等级徽标的语义 class 后缀。K1–K5 是**同一条难度轴上的五档**，
 * 所以按「越难越红」分三组着色，而不是五档五色（五色会让老人分不清色差，只会分不清）。
 *
 * 非法值（理论上不该出现：catalog.ts 已经把 level 收敛成 `Level | null`）
 * 一律退化成最中性的 k1 灰蓝，**不退化成任何「已标注」的语气**。
 */
export function levelTone(level: Level | string | null | undefined): string {
  switch (level) {
    case 'K1':
    case 'K2':
      return 'level--easy'
    case 'K3':
      return 'level--mid'
    case 'K4':
    case 'K5':
      return 'level--hard'
    default:
      return 'level--unset'
  }
}
