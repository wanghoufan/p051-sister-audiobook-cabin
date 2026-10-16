import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatDuration,
  formatMinutes,
  levelTone,
} from '../../src/lib/format'

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [65, '1:05'],
    [754, '12:34'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3723, '1:02:03'],
    [7323.9, '2:02:03'],
  ])('%s → %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected)
  })

  it('非法输入返回破折号', () => {
    expect(formatDuration(Number.NaN)).toBe('—')
    expect(formatDuration(-1)).toBe('—')
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration('600')).toBe('—')
    expect(formatDuration(undefined)).toBe('—')
  })
})

describe('formatMinutes', () => {
  it.each([
    [0, '不到 1 分钟'],
    [59, '不到 1 分钟'],
    [60, '约 1 分钟'],
    [300, '约 5 分钟'],
    [900, '约 15 分钟'],
    [1800, '约 30 分钟'],
  ])('%s → %s', (seconds, expected) => {
    expect(formatMinutes(seconds)).toBe(expected)
  })

  it('非法输入返回破折号', () => {
    expect(formatMinutes(Number.NaN)).toBe('—')
    expect(formatMinutes(-5)).toBe('—')
    expect(formatMinutes('x')).toBe('—')
  })
})

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [10 * 1024, '10 KB'],
    [1024 * 1024, '1.0 MB'],
    [1024 * 1024 * 1024, '1.0 GB'],
  ])('%s → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })

  it('非法输入返回破折号', () => {
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(null)).toBe('—')
  })
})

describe('levelTone', () => {
  it('K1–K5 分三组着色，且「难」的组一定比「容易」的组更靠后', () => {
    expect(levelTone('K1')).toBe('level--easy')
    expect(levelTone('K2')).toBe('level--easy')
    expect(levelTone('K3')).toBe('level--mid')
    expect(levelTone('K4')).toBe('level--hard')
    expect(levelTone('K5')).toBe('level--hard')
    // 五档不是五种颜色：视力偏弱的用户分不出相邻色差，三组才是他能用的信息量
    expect(new Set(['K1', 'K2', 'K3', 'K4', 'K5'].map((k) => levelTone(k))).size).toBe(3)
  })

  it('null / 非法值退化成中性态，绝不退化成任何一个「已标注」的等级语气', () => {
    for (const bad of [null, undefined, 'K0', 'K6', 'beginner', '', 42]) {
      expect(levelTone(bad as never)).toBe('level--unset')
    }
    expect(levelTone(null)).not.toBe(levelTone('K1'))
  })
})
