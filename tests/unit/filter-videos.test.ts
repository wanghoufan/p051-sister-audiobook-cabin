import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTERS,
  bucketForDuration,
  countActiveFilters,
  filterVideos,
  isFilterEmpty,
  matchesFilters,
} from '../../src/lib/filter-videos'
import type { FilterState } from '../../src/lib/filter-videos'
import type { Video } from '../../src/lib/types'
import { DURATION_BUCKETS } from '../../src/lib/types'

const DURATION_BUCKET_IDS = DURATION_BUCKETS.map((b) => b.id)

function makeVideo(partial: Partial<Video> & { id: string }): Video {
  return {
    relativePath: `videos/${partial.id}.mp4`,
    title: partial.id,
    durationSeconds: 600,
    types: ['cardio'],
    // 默认给一个已识别的等级；「没识别出来」的场景显式传 level: null。
    level: 'K2',
    hasThumbnail: true,
    thumbnailUrl: `/thumbs/${partial.id}.jpg`,
    playbackUrl: `/api/stream/${partial.id}`,
    available: true,
    ...partial,
  }
}

describe('bucketForDuration 边界', () => {
  it.each([
    [0, 'le5'],
    [1, 'le5'],
    [299.9, 'le5'],
    [300, 'le5'],
    [300.001, 'gt5to15'],
    [301, 'gt5to15'],
    [900, 'gt5to15'],
    [900.001, 'gt15to30'],
    [901, 'gt15to30'],
    [1800, 'gt15to30'],
    [1800.001, 'gt30'],
    [3600, 'gt30'],
    [100000, 'gt30'],
  ])('%s 秒归入 %s', (seconds, bucket) => {
    expect(bucketForDuration(seconds)).toBe(bucket)
  })

  it('非法输入不会抛错，且仍落在某个桶里', () => {
    expect(bucketForDuration(Number.NaN)).toBe('le5')
    expect(bucketForDuration(-10)).toBe('le5')
    expect(bucketForDuration(Number.POSITIVE_INFINITY)).toBe('gt30')
    expect(DURATION_BUCKET_IDS).toContain(bucketForDuration(Number.NaN))
  })
})

describe('matchesFilters', () => {
  it('空筛选匹配任意可播放视频', () => {
    expect(matchesFilters(makeVideo({ id: 'a' }), EMPTY_FILTERS)).toBe(true)
  })

  // 单选语义：三个维度各自最多一个值，所以维度内部不存在并集。
  it('单选：等级只认自己那一个（K1 不会顺带命中 K3）', () => {
    const v = makeVideo({ id: 'a', level: 'K3' })
    expect(matchesFilters(v, { types: [], level: 'K1', duration: null })).toBe(false)
    expect(matchesFilters(v, { types: [], level: 'K3', duration: null })).toBe(true)
  })

  it('单选：时长只认自己那一个桶', () => {
    const v = makeVideo({ id: 'a', durationSeconds: 1200 })
    expect(matchesFilters(v, { types: [], level: null, duration: 'le5' })).toBe(false)
    expect(matchesFilters(v, { types: [], level: null, duration: 'gt15to30' })).toBe(true)
  })

  it('维度之间取交集：K1 + ≤5min 只要「等级 K1 且 5 分钟以内」', () => {
    const hit = makeVideo({ id: 'hit', level: 'K1', durationSeconds: 300 })
    const wrongLevel = makeVideo({ id: 'wrong-level', level: 'K2', durationSeconds: 300 })
    const wrongDuration = makeVideo({ id: 'wrong-duration', level: 'K1', durationSeconds: 900.001 })
    const f: FilterState = { types: [], level: 'K1', duration: 'le5' }
    expect(matchesFilters(hit, f)).toBe(true)
    expect(matchesFilters(wrongLevel, f)).toBe(false)
    expect(matchesFilters(wrongDuration, f)).toBe(false)
  })

  it('类型是单选：一条视频只要沾上被选中的那个类型就算命中', () => {
    const v = makeVideo({ id: 'a', types: ['cardio', 'upper'], level: 'K3' })
    expect(matchesFilters(v, { types: ['cardio'], level: null, duration: null })).toBe(true)
    expect(matchesFilters(v, { types: ['upper'], level: null, duration: null })).toBe(true)
    expect(matchesFilters(v, { types: ['core'], level: null, duration: null })).toBe(false)
  })

  it('不同维度取交集', () => {
    const v = makeVideo({ id: 'a', types: ['upper'], level: 'K3', durationSeconds: 1200 })
    const filters: FilterState = {
      types: ['upper'],
      level: 'K3',
      duration: 'gt5to15',
    }
    expect(matchesFilters(v, filters)).toBe(false)
    expect(matchesFilters(v, { ...filters, duration: 'gt15to30' })).toBe(true)
  })

  // 核心产品决定：等级是人工从封面原图识图补齐的，null 一律不命中任何等级。
  it('level 为 null 的视频，选了任何等级都不匹配（绝不猜成 K1）', () => {
    const v = makeVideo({ id: 'a', level: null })
    for (const level of ['K1', 'K2', 'K3', 'K4', 'K5'] as const) {
      expect(matchesFilters(v, { types: [], level: level, duration: null }), level).toBe(false)
    }
    // 多个等级一起选也一样不命中
    expect(matchesFilters(v, { types: [], level: 'K1', duration: null })).toBe(false)
    // 但不选等级时它照常出现
    expect(matchesFilters(v, EMPTY_FILTERS)).toBe(true)
  })

  // 等级只来自课程封面原图。difficulty 已整体删除，Video 上不存在这个字段，
  // 所以「从别处兜底推一个 K 值」在类型层面就已经不可能了。
  it('Video 上不再有 difficulty 字段：没有任何旁路能推出 level', () => {
    const v = makeVideo({ id: 'a', level: null })
    expect('difficulty' in v).toBe(false)
    for (const level of ['K1', 'K2', 'K3', 'K4', 'K5'] as const) {
      expect(matchesFilters(v, { types: [], level, duration: null }), level).toBe(false)
    }
  })

  it('available=false 一律不匹配', () => {
    const v = makeVideo({ id: 'a', available: false })
    expect(matchesFilters(v, EMPTY_FILTERS)).toBe(false)
    expect(matchesFilters(v, { types: ['cardio'], level: 'K2', duration: 'gt5to15' })).toBe(
      false,
    )
  })
})

describe('filterVideos', () => {
  const videos: Video[] = [
    makeVideo({ id: 'a', types: ['cardio'], level: 'K1', durationSeconds: 300 }),
    makeVideo({ id: 'b', types: ['upper'], level: 'K3', durationSeconds: 900.001 }),
    makeVideo({ id: 'c', types: ['core'], level: null, durationSeconds: 1800.001 }),
    makeVideo({ id: 'gone', types: ['cardio'], level: 'K1', available: false }),
  ]

  it('空筛选返回全部可播放视频', () => {
    expect(filterVideos(videos, EMPTY_FILTERS).map((v) => v.id)).toEqual(['a', 'b', 'c'])
  })

  // 语义澄清（QA m-1）：旧注释写「空筛选原样返回全部、不复制数组」，与实现相反。
  // 实现保留（筛选页只给能播的），这里把真实语义钉死，防止注释和行为再次跑偏。
  it('空筛选 ≠ 全量：available:false 被剔除，而全量请直接用 videos 数组', () => {
    expect(filterVideos(videos, EMPTY_FILTERS)).toHaveLength(videos.length - 1)
    expect(videos.map((v) => v.id)).toContain('gone')
  })

  it('永远返回新数组，调用方不能用引用比较判断结果是否变化', () => {
    const out = filterVideos(videos, EMPTY_FILTERS)
    expect(out).not.toBe(videos)
    expect(out).not.toBe(filterVideos(videos, EMPTY_FILTERS))
  })

  it('按类型筛选（单选：cardio 和 core 分开断言，不再是并集）', () => {
    expect(
      filterVideos(videos, { types: ['cardio'], level: null, duration: null }).map((v) => v.id),
    ).toEqual(['a'])
    expect(
      filterVideos(videos, { types: ['core'], level: null, duration: null }).map((v) => v.id),
    ).toEqual(['c'])
    expect(
      filterVideos(videos, { types: ['upper'], level: null, duration: null }).map((v) => v.id),
    ).toEqual(['b'])
  })

  it('按等级筛选不会把未识图（level:null）混进任何一档', () => {
    expect(
      filterVideos(videos, { types: [], level: 'K1', duration: null }).map((v) => v.id),
    ).toEqual(['a'])
    expect(
      filterVideos(videos, { types: [], level: 'K3', duration: null }).map((v) => v.id),
    ).toEqual(['b'])
    // c 的 level 是 null，任何等级都命中不了它
    expect(filterVideos(videos, { types: [], level: 'K2', duration: null })).toEqual([])
  })

  it('单选交集：等级 + 时长同时生效（K1 且 ≤5min）', () => {
    expect(
      filterVideos(videos, { types: [], level: 'K1', duration: 'le5' }).map((v) => v.id),
    ).toEqual(['a'])
    // K1 但超过 5 分钟 → 交集为空
    expect(filterVideos(videos, { types: [], level: 'K1', duration: 'gt5to15' })).toEqual([])
  })

  it('按时长筛选使用严格边界（单选：每桶单独断言）', () => {
    // a=300 归 le5；b=900.001 归 gt15to30；c=1800.001 归 gt30
    expect(filterVideos(videos, { types: [], level: null, duration: 'le5' }).map((v) => v.id)).toEqual([
      'a',
    ])
    expect(filterVideos(videos, { types: [], level: null, duration: 'gt5to15' }).map((v) => v.id)).toEqual(
      [],
    )
    // 单选语义：gt15to30 只剩 b 一条，c（1800.001）严格落在 gt30
    expect(filterVideos(videos, { types: [], level: null, duration: 'gt15to30' }).map((v) => v.id)).toEqual([
      'b',
    ])
    expect(filterVideos(videos, { types: [], level: null, duration: 'gt30' }).map((v) => v.id)).toEqual(['c'])
  })

  it('三维度同时生效', () => {
    expect(
      filterVideos(videos, {
        types: ['core'],
        level: 'K5',
        duration: 'gt30',
      }).map((v) => v.id),
    ).toEqual([])
    // core + K5 不命中 c（它是 null），但把等级去掉就有了 —— 说明确实是等级在拦
    expect(
      filterVideos(videos, { types: ['core'], level: null, duration: 'gt30' }).map((v) => v.id),
    ).toEqual(['c'])
  })

  it('不修改入参数组', () => {
    const snapshot = JSON.stringify(videos)
    filterVideos(videos, { types: ['cardio'], level: 'K1', duration: 'le5' })
    expect(JSON.stringify(videos)).toBe(snapshot)
  })
})

describe('EMPTY_FILTERS / countActiveFilters / isFilterEmpty', () => {
  it('EMPTY_FILTERS：类型空数组 + 等级 null + 时长 null', () => {
    expect(EMPTY_FILTERS).toEqual({ types: [], level: null, duration: null })
  })

  it('单选后每个维度最多贡献 1，条件总数最大为 3', () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0)
    expect(countActiveFilters({ types: ['cardio'], level: 'K1', duration: 'le5' })).toBe(3)
    expect(countActiveFilters({ types: [], level: 'K1', duration: null })).toBe(1)
    expect(countActiveFilters({ types: ['core'], level: null, duration: 'gt30' })).toBe(2)
  })

  it('空判定', () => {
    expect(isFilterEmpty(EMPTY_FILTERS)).toBe(true)
    expect(isFilterEmpty({ types: [], level: null, duration: 'gt30' })).toBe(false)
  })
})
