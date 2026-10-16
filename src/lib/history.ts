/**
 * 练习历史 —— 「练过哪些、练到哪儿」的本地记录。
 *
 * 与 `last-training.ts` 的分工：
 *   - `last-training`：**只存一条**「上次练到哪」，用于首页那个「继续播放」入口。
 *     看完就清空（首页不该再提示续播一个已经练完的课）。
 *   - `history`：**存多条**，一条视频一条，用于「历史」tab。
 *     看完**不删**，只把 `completed` 置为 true —— 「练过」这件事本身就是用户想看到的。
 *
 * 两者各写各的 key，互不干扰：删掉历史不该让首页的续播入口消失，
 * 反之亦然。
 *
 * 存储边界（红线 5）：全部只存在本机 localStorage，**不上云、不同步**。
 * 换手机 / 清站点数据 = 记录全丢，这是预期行为，不是错误。
 */

export const HISTORY_KEY = 'keep-family-fitness:history:v1'
export const HISTORY_VERSION = 1

/** 最多保留多少条。130 个视频，足够记完全部；超过就丢最久没碰过的那些。 */
export const HISTORY_MAX_ENTRIES = 200

/**
 * 看过多少秒才算「练过」并建记录。低于这个值说明只是点开看了一眼就退出，
 * 不该在历史里留一条「练了 0 秒」的噪声记录。
 */
export const HISTORY_MIN_SECONDS = 5

export interface HistoryEntry {
  version: 1
  videoId: string
  /** 最近一次退出的位置（秒）。 */
  positionSeconds: number
  /** 累计练了多少次。每次点播放 +1，用来看「这条课我练过几遍」。 */
  playCount: number
  /** 是否完整练完过（ended 事件触发过）。 */
  completed: boolean
  /** 第一次开始练的时间戳。 */
  firstPlayedAt: number
  /** 最近一次练的时间戳。列表按它倒序排。 */
  lastPlayedAt: number
}

/**
 * 解析 localStorage；Safari 无痕 / 隐私模式 / 非浏览器环境会抛 SecurityError，
 * 吞掉返回 null，让所有读写函数走「不可用即静默降级」的路径。
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

/** 单条记录的合法性校验。脏数据一律丢弃而不是勉强解析 —— 半个数字算不出进度。 */
function parseEntry(raw: unknown): HistoryEntry | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  if (rec.version !== HISTORY_VERSION) return null
  if (typeof rec.videoId !== 'string' || rec.videoId.length === 0) return null
  if (typeof rec.positionSeconds !== 'number' || !Number.isFinite(rec.positionSeconds)) return null
  if (rec.positionSeconds < 0) return null
  if (typeof rec.playCount !== 'number' || !Number.isFinite(rec.playCount)) return null
  if (typeof rec.completed !== 'boolean') return null
  if (typeof rec.firstPlayedAt !== 'number' || !Number.isFinite(rec.firstPlayedAt)) return null
  if (typeof rec.lastPlayedAt !== 'number' || !Number.isFinite(rec.lastPlayedAt)) return null
  return {
    version: HISTORY_VERSION,
    videoId: rec.videoId,
    positionSeconds: rec.positionSeconds,
    playCount: rec.playCount,
    completed: rec.completed,
    firstPlayedAt: rec.firstPlayedAt,
    lastPlayedAt: rec.lastPlayedAt,
  }
}

/**
 * 读全部历史记录，**按 lastPlayedAt 倒序**（最近练的在前）。
 * 任何异常或脏数据都返回空数组，绝不抛异常。
 *
 * 单条脏数据不会让整份历史作废：解析失败的条目被跳过，其余照常返回。
 * （last-training 是「全有或全无」，因为它只有一条；这里是列表，容错更宽。）
 */
export function readHistory(storage?: Storage | null): HistoryEntry[] {
  const store = resolveStorage(storage)
  if (!store) return []
  let raw: string | null
  try {
    raw = store.getItem(HISTORY_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: HistoryEntry[] = []
  for (const item of parsed) {
    const entry = parseEntry(item)
    if (entry) out.push(entry)
  }
  out.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
  return out
}

/**
 * 写入/更新一条历史记录。
 *
 * 语义是 **upsert**：同一个 videoId 已存在就更新它（position/playCount/lastPlayedAt），
 * 不存在就新增。`firstPlayedAt` 与 `playCount` 在已有记录上**保留/递增**，
 * 新记录才初始化 —— 「这条课我练过几遍、第一次是什么时候练的」是用户想看的信息，
 * 每次覆盖就把历史抹平了。
 *
 * 超过 HISTORY_MAX_ENTRIES 时丢最久没碰过的那些（列表已按时间倒序，切尾即可）。
 */
export function recordHistory(
  update: {
    videoId: string
    positionSeconds: number
    completed?: boolean
    /** 每次「开始播放」调用一次，用来累加 playCount；中途存进度时不传。 */
    newSession?: boolean
  },
  storage?: Storage | null,
): boolean {
  const store = resolveStorage(storage)
  if (!store) return false
  if (typeof update.videoId !== 'string' || update.videoId.length === 0) return false
  if (!Number.isFinite(update.positionSeconds) || update.positionSeconds < 0) return false

  const now = Date.now()
  const existing = readHistory(store)
  const prev = existing.find((entry) => entry.videoId === update.videoId)
  const next: HistoryEntry = {
    version: HISTORY_VERSION,
    videoId: update.videoId,
    positionSeconds: update.positionSeconds,
    // completed 只升不降：once true 就一直 true，中途续播不该把「练完过」抹掉
    completed: update.completed === true || (prev?.completed ?? false),
    playCount: (prev?.playCount ?? 0) + (update.newSession === true ? 1 : 0),
    firstPlayedAt: prev?.firstPlayedAt ?? now,
    lastPlayedAt: now,
  }

  const merged = [next, ...existing.filter((entry) => entry.videoId !== update.videoId)]
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, HISTORY_MAX_ENTRIES)

  try {
    store.setItem(HISTORY_KEY, JSON.stringify(merged))
    return true
  } catch {
    return false
  }
}

/**
 * 标记某条视频「已练完」。视频已不在列表里时静默返回（不加记录）——
 * 练完一个目录里没有的 id 不该凭空造一条历史。
 */
export function markCompleted(videoId: string, storage?: Storage | null): boolean {
  const store = resolveStorage(storage)
  if (!store) return false
  const existing = readHistory(store)
  const found = existing.some((entry) => entry.videoId === videoId)
  if (!found) return false
  return recordHistory({ videoId, positionSeconds: 0, completed: true }, store)
}

/** 删掉一条历史记录（「不想要这条了」）。不存在时静默返回。 */
export function removeHistoryEntry(videoId: string, storage?: Storage | null): void {
  const store = resolveStorage(storage)
  if (!store) return
  const remaining = readHistory(store).filter((entry) => entry.videoId !== videoId)
  try {
    store.setItem(HISTORY_KEY, JSON.stringify(remaining))
  } catch {
    /* 忽略：删不掉不影响使用 */
  }
}

/** 清空全部历史。返回是否真的清掉了（存储不可用时返回 false）。 */
export function clearHistory(storage?: Storage | null): boolean {
  const store = resolveStorage(storage)
  if (!store) return false
  try {
    store.removeItem(HISTORY_KEY)
    return true
  } catch {
    return false
  }
}

/**
 * 这条记录现在能不能「继续」—— 即上次是练到一半退出的。
 *
 * 判据与 `isResumablePosition` 一致：至少看过 5 秒，且离结尾还有 10 秒以上。
 * 已经练完的（completed）永远不该显示「继续」，该显示的是「再看一遍」。
 */
export function canResume(entry: HistoryEntry, durationSeconds: number): boolean {
  if (entry.completed) return false
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false
  if (entry.positionSeconds < HISTORY_MIN_SECONDS) return false
  return durationSeconds - entry.positionSeconds >= 10
}

/** 进度百分比（0–100），用于进度条宽度。 */
export function historyPercent(entry: HistoryEntry, durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return entry.completed ? 100 : 0
  if (entry.completed) return 100
  return Math.max(2, Math.min(100, Math.round((entry.positionSeconds / durationSeconds) * 100)))
}
