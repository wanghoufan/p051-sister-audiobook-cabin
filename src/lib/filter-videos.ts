import { DURATION_BUCKETS } from './types'
import type { DurationBucketId, Level, Video, VideoType } from './types'

export interface FilterState {
  /**
   * 选中的视频类型。**类型是单选**（一次只看一类），所以这里仍然用数组承载，
   * 但长度最多为 1；用数组而不是 `VideoType | null` 是为了让 URL 序列化
   * （`types=core`）、清空判定、以及「多维度取交集」的既有代码形状都原样保留，
   * 不必为一次 UI 简化把整条 URL 协议换掉。
   */
  types: VideoType[]
  /**
   * 选中的等级（K1–K5），**单选**。null = 不按等级筛。
   *
   * 为什么是单值而不是数组：产品要求「点 K1 就只剩 K1，点 K2 就只剩 K2」。
   * 多选会让人以为「不选 = 全都要」，而 60+ 的用户想的是「我今天就练这个等级」。
   * 取消方式是**再点一次当前已选中的那个**（见 VideoFilters 的 pick 函数），
   * 页面不提供「清除全部」按钮。
   */
  level: Level | null
  /** 选中的时长桶，**单选**。null = 不按时长筛。取消方式同上。 */
  duration: DurationBucketId | null
}

export const EMPTY_FILTERS: FilterState = { types: [], level: null, duration: null }

/**
 * 把时长（秒）映射到分桶。用 min <= x <= max 的闭区间判定，
 * 保证 300 / 900 / 1800 三个整点分别落在较小的桶里，边界不重叠也不漏。
 * NaN 归到 le5、负数落到兜底的 le5、Infinity 自然落到 gt30，
 * 目的是「宁可放进一个桶也不要静默消失」，让这类脏数据在页面上仍然可见。
 */
export function bucketForDuration(durationSeconds: number): DurationBucketId {
  const seconds = Number.isNaN(durationSeconds) ? 0 : durationSeconds
  for (const bucket of DURATION_BUCKETS) {
    if (seconds >= bucket.minSeconds && seconds <= bucket.maxSeconds) return bucket.id
  }
  return 'le5'
}

/**
 * 判断单条视频是否命中筛选条件。
 *
 * **三个维度之间一律取交集**，维度内部没有并集概念（三个维度都是单选）：
 *   类型 = 核心  且  等级 = K1  且  时长 = ≤5min
 *     → 只剩「类型是核心、等级是 K1、时长不超过 5 分钟」的视频。
 *   任一维度为 null（没选）时该维度不参与过滤。
 *
 * 三个产品决定（写在这里以便 UI 理解行为）：
 * 1. available === false 一律不匹配 —— 筛选页的用途是「挑一个现在就能播的视频」，
 *    首页把不可播放的标灰展示是另一回事，由页面自己处理。
 * 2. **level === null 的视频在用户选了任何等级时一律不匹配。** 这不是 bug，是刻意选择：
 *    等级是从课程封面原图上人工识图补齐的，还没补齐的条目如果被算进「K1」，
 *    60+ 的用户就会照着一个猜出来的标签去练 —— 错标比不标危险得多。
 *    代价是点 K2 可能看到 0 条，而这恰恰是诚实信号：「这条还没识别」，
 *    而不是「这条是 K2」。把识别结果写进 catalog/annotations.json 就自然补上。
 * 3. **等级只有 K1–K5 一套体系，没有任何可推导的旁路。** 旧的 3 档 difficulty 已整体删除：
 *    它与 K 值不线性对应（一条标 advanced 的「引体向上 10-19 个」封面印的是 K3），
 *    任何映射表都是错的，所以宁可没有，也别留一张会骗人的表。
 */
export function matchesFilters(video: Video, filters: FilterState): boolean {
  if (video.available === false) return false
  if (filters.types.length > 0 && !video.types.some((t) => filters.types.includes(t))) {
    return false
  }
  if (filters.level !== null) {
    // 不兜底：null 不匹配任何等级，也绝不由别的东西推导出���个 K 值。
    if (video.level === null) return false
    if (video.level !== filters.level) return false
  }
  if (filters.duration !== null && bucketForDuration(video.durationSeconds) !== filters.duration) {
    return false
  }
  return true
}

/**
 * 对视频列表应用筛选条件。**空筛选不等于「原样返回全部」**：
 * 空筛选的结果是「全部可播放的视频」，也就是剔除掉 `available === false` 的条目
 * （筛选页的用途是「挑一个现在就能播的视频」），而且**永远返回一个新数组**，
 * 调用方不要写 `prev === next` 这类引用比较来判断结果有没有变。
 *
 * 需要真正的全量列表（包含 `available: false` 的条目，首页要把它们标灰展示）时，
 * 请直接用 `videos` 数组本身，不要经过本函数。
 */
export function filterVideos(videos: Video[], filters: FilterState): Video[] {
  if (isFilterEmpty(filters)) return videos.filter((v) => v.available !== false)
  return videos.filter((video) => matchesFilters(video, filters))
}

/** 当前生效的条件个数（类型 + 等级 + 时长，各最多 1）。用于判断「是否完全没筛」。 */
export function countActiveFilters(filters: FilterState): number {
  return (
    filters.types.length +
    (filters.level !== null ? 1 : 0) +
    (filters.duration !== null ? 1 : 0)
  )
}

/** 是否一个条件都没选；用于区分「没筛选」和「筛完没结果」两种空态。 */
export function isFilterEmpty(filters: FilterState): boolean {
  return countActiveFilters(filters) === 0
}
