import { describe, expect, it } from 'vitest'
import {
  DURATION_BUCKETS,
  LEVEL_ORDER,
  VIDEO_TYPE_LABELS,
  VIDEO_TYPE_ORDER,
} from '../../src/lib/types'
import { isTwoLineType, typeLabelLines } from '../../src/lib/types'
import type { DurationBucketId, Level, VideoType } from '../../src/lib/types'

describe('types 常量表', () => {
  it('VIDEO_TYPE_LABELS 覆盖全部 VideoType，且文案正确', () => {
    const all: VideoType[] = [
      'cardio', 'upper', 'lower', 'fullbody', 'core', 'stretch',
      'balance', 'running', 'pilates', 'sleep', 'yoga', 'baduanjin',
    ]
    for (const t of all) {
      expect(VIDEO_TYPE_LABELS[t]).toBeTruthy()
    }
    // 文案由用户逐条确认（见项目 Skill p038-video-tagging/references/taxonomy.md）
    expect(VIDEO_TYPE_LABELS).toEqual({
      cardio: '有氧',
      upper: '上肢力量',
      lower: '下肢力量',
      fullbody: '全身力量',
      core: '核心',
      stretch: '拉伸',
      balance: '平衡',
      running: '跑步专项',
      pilates: '普拉提',
      sleep: '助眠',
      yoga: '瑜伽',
      baduanjin: '八段锦',
    })
  })

  it('VIDEO_TYPE_ORDER 覆盖全部类型且无重复（类型分类栏要靠它渲染，不能漏项）', () => {
    expect(new Set(VIDEO_TYPE_ORDER).size).toBe(VIDEO_TYPE_ORDER.length)
    for (const t of Object.keys(VIDEO_TYPE_LABELS)) expect(VIDEO_TYPE_ORDER).toContain(t as VideoType)
    expect(VIDEO_TYPE_ORDER).toEqual([
      'cardio', 'fullbody', 'core', 'upper', 'lower',
      'running', 'pilates', 'stretch', 'balance', 'yoga', 'sleep', 'baduanjin',
    ])
  })

  it('4 个字的标签拆两行，2/3 个字的一行（用户要求）', () => {
    // 4 个字：上肢/下肢/全身力量、跑步专项
    expect(typeLabelLines('upper')).toEqual(['上肢', '力量'])
    expect(typeLabelLines('lower')).toEqual(['下肢', '力量'])
    expect(typeLabelLines('fullbody')).toEqual(['全身', '力量'])
    expect(typeLabelLines('running')).toEqual(['跑步', '专项'])
    // 其余不拆
    expect(typeLabelLines('cardio')).toEqual(['有氧'])
    expect(typeLabelLines('core')).toEqual(['核心'])
    expect(typeLabelLines('pilates')).toEqual(['普拉提'])
    expect(typeLabelLines('baduanjin')).toEqual(['八段锦'])
    // 判定只认字数，新增类型不用改这里
    for (const t of Object.keys(VIDEO_TYPE_LABELS) as VideoType[]) {
      const lines = typeLabelLines(t)
      expect(lines.join('')).toBe(VIDEO_TYPE_LABELS[t])
      expect(isTwoLineType(t)).toBe(lines.length === 2)
    }
  })

  it('LEVEL_ORDER 是 K1–K5 五档、从轻到难、无重复', () => {
    expect(LEVEL_ORDER).toEqual<Level[]>(['K1', 'K2', 'K3', 'K4', 'K5'])
    expect(new Set(LEVEL_ORDER).size).toBe(5)
  })



  it('DURATION_BUCKETS 的边界与标签符合 FR-005（标签可以改短，边界一个都不能动）', () => {
    const byId = new Map(DURATION_BUCKETS.map((b) => [b.id, b]))
    expect(byId.get('le5')).toEqual({ id: 'le5', label: '≤5min', minSeconds: 0, maxSeconds: 300 })
    expect(byId.get('gt5to15')).toEqual({
      id: 'gt5to15',
      label: '6-15min',
      minSeconds: 300,
      maxSeconds: 900,
    })
    expect(byId.get('gt15to30')).toEqual({
      id: 'gt15to30',
      label: '16-30min',
      minSeconds: 900,
      maxSeconds: 1800,
    })
    expect(byId.get('gt30')).toEqual({
      id: 'gt30',
      label: '≥31min',
      minSeconds: 1800,
      maxSeconds: Infinity,
    })
    expect(DURATION_BUCKETS.map((b) => b.id)).toEqual<DurationBucketId[]>([
      'le5',
      'gt5to15',
      'gt15to30',
      'gt30',
    ])
  })

  it('相邻桶首尾相接、无空洞无重叠（300/900/1800 三个整点只落在较小的桶里）', () => {
    for (let i = 1; i < DURATION_BUCKETS.length; i += 1) {
      expect(DURATION_BUCKETS[i].minSeconds).toBe(DURATION_BUCKETS[i - 1].maxSeconds)
    }
    expect(DURATION_BUCKETS[0].minSeconds).toBe(0)
    expect(DURATION_BUCKETS[DURATION_BUCKETS.length - 1].maxSeconds).toBe(Infinity)
  })
})
