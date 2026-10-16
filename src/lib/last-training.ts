export const LAST_TRAINING_KEY = 'keep-family-fitness:last-training:v1'
export const LAST_TRAINING_VERSION = 1

/** 少于这个秒数视为「刚开始看」，不提示续播，避免一进播放页就弹进度条。 */
export const LAST_TRAINING_MIN_RESUME_SECONDS = 5
/** 距离结尾不足这个秒数视为「已看完」，不再提示续播（SPEC US3 第 3 条）。 */
export const LAST_TRAINING_END_GUARD_SECONDS = 10

export interface LastTraining {
  version: 1
  videoId: string
  positionSeconds: number
  updatedAt: number
}

/**
 * 解析默认的 localStorage；Safari 无痕/隐私模式或非浏览器环境下访问会抛 SecurityError，
 * 这里吞掉并返回 null，让所有读写函数进入「不可用即静默降级」的路径。
 */
function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage === undefined) return defaultStorage()
  return storage
}

/**
 * 读取上次训练记录。任何异常或脏数据（JSON 损坏、版本不符、结构不对）都返回 null，
 * 绝不抛异常 —— 换设备/清站点数据丢失记录是预期行为，不是错误。
 */
export function readLastTraining(storage?: Storage | null): LastTraining | null {
  const store = resolveStorage(storage)
  if (!store) return null
  let raw: string | null
  try {
    raw = store.getItem(LAST_TRAINING_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const rec = parsed as Record<string, unknown>
    if (rec.version !== LAST_TRAINING_VERSION) return null
    if (typeof rec.videoId !== 'string' || rec.videoId.length === 0) return null
    if (typeof rec.positionSeconds !== 'number' || !Number.isFinite(rec.positionSeconds)) return null
    if (rec.positionSeconds < 0) return null
    if (typeof rec.updatedAt !== 'number' || !Number.isFinite(rec.updatedAt)) return null
    return {
      version: LAST_TRAINING_VERSION,
      videoId: rec.videoId,
      positionSeconds: rec.positionSeconds,
      updatedAt: rec.updatedAt,
    }
  } catch {
    return null
  }
}

/**
 * 写入上次训练记录。localStorage 不可用（无痕、配额满、SecurityError）时返回 false，
 * 调用方据此放弃持久化但不打断播放。updatedAt 由本函数生成，调用方无需关心时钟。
 */
export function writeLastTraining(
  rec: { videoId: string; positionSeconds: number },
  storage?: Storage | null,
): boolean {
  const store = resolveStorage(storage)
  if (!store) return false
  if (typeof rec.videoId !== 'string' || rec.videoId.length === 0) return false
  if (!Number.isFinite(rec.positionSeconds) || rec.positionSeconds < 0) return false
  const payload: LastTraining = {
    version: LAST_TRAINING_VERSION,
    videoId: rec.videoId,
    positionSeconds: rec.positionSeconds,
    updatedAt: Date.now(),
  }
  try {
    store.setItem(LAST_TRAINING_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

/** 清除记录；不可用时静默返回，让「清除上次训练」按钮不会报错。 */
export function clearLastTraining(storage?: Storage | null): void {
  const store = resolveStorage(storage)
  if (!store) return
  try {
    store.removeItem(LAST_TRAINING_KEY)
  } catch {
    /* 忽略：清不掉不影响使用 */
  }
}

/**
 * 位置是否值得提示续播：至少看过 5 秒，且离结尾至少还有 10 秒。
 * durationSeconds 非法或不足时返回 false，宁可不提示也不给出坏进度。
 */
export function isResumablePosition(positionSeconds: number, durationSeconds: number): boolean {
  if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds)) return false
  if (positionSeconds < LAST_TRAINING_MIN_RESUME_SECONDS) return false
  if (durationSeconds <= 0) return false
  return durationSeconds - positionSeconds >= LAST_TRAINING_END_GUARD_SECONDS
}
