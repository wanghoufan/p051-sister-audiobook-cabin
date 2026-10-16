import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LAST_TRAINING_END_GUARD_SECONDS,
  LAST_TRAINING_KEY,
  LAST_TRAINING_MIN_RESUME_SECONDS,
  LAST_TRAINING_VERSION,
  clearLastTraining,
  isResumablePosition,
  readLastTraining,
  writeLastTraining,
} from '../../src/lib/last-training'

/** 手写的 fake Storage：只实现用到的方法，可注入抛错行为。 */
function makeFakeStorage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial))
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
  }
  return { storage: storage as unknown as Storage, data }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('常量', () => {
  it('key 与版本号固定', () => {
    expect(LAST_TRAINING_KEY).toBe('keep-family-fitness:last-training:v1')
    expect(LAST_TRAINING_VERSION).toBe(1)
  })

  it('续播阈值常量符合设计', () => {
    expect(LAST_TRAINING_MIN_RESUME_SECONDS).toBe(5)
    expect(LAST_TRAINING_END_GUARD_SECONDS).toBe(10)
  })
})

describe('writeLastTraining / readLastTraining', () => {
  it('正常写入后能读回，updatedAt 由写入方生成', () => {
    const { storage, data } = makeFakeStorage()
    expect(writeLastTraining({ videoId: 'v1', positionSeconds: 42.5 }, storage)).toBe(true)
    expect(writeLastTraining({ videoId: 'v1', positionSeconds: 42.5 }, storage)).toBe(true)
    const parsed = JSON.parse(data.get(LAST_TRAINING_KEY)!)
    expect(parsed.version).toBe(1)
    expect(parsed.positionSeconds).toBe(42.5)
    expect(parsed.updatedAt).toBe(new Date('2026-01-02T03:04:05.000Z').getTime())
    expect(readLastTraining(storage)).toEqual({
      version: 1,
      videoId: 'v1',
      positionSeconds: 42.5,
      updatedAt: new Date('2026-01-02T03:04:05.000Z').getTime(),
    })
  })

  it('空 storage 时读回 null', () => {
    const { storage } = makeFakeStorage()
    expect(readLastTraining(storage)).toBeNull()
  })

  it('损坏 JSON 返回 null 且不抛', () => {
    const { storage } = makeFakeStorage({ [LAST_TRAINING_KEY]: '{not json' })
    expect(() => readLastTraining(storage)).not.toThrow()
    expect(readLastTraining(storage)).toBeNull()
  })

  it('JSON 是数组或 null 时返回 null', () => {
    const { storage } = makeFakeStorage({ [LAST_TRAINING_KEY]: '[1,2]' })
    expect(readLastTraining(storage)).toBeNull()
    const { storage: s2 } = makeFakeStorage({ [LAST_TRAINING_KEY]: 'null' })
    expect(readLastTraining(s2)).toBeNull()
  })

  it('version 不等于 1 返回 null', () => {
    const { storage } = makeFakeStorage({
      [LAST_TRAINING_KEY]: JSON.stringify({ version: 2, videoId: 'v1', positionSeconds: 10, updatedAt: 1 }),
    })
    expect(readLastTraining(storage)).toBeNull()
  })

  it('videoId 非空串才接受', () => {
    const base = { version: 1, positionSeconds: 10, updatedAt: 1 }
    const { storage: s1 } = makeFakeStorage({ [LAST_TRAINING_KEY]: JSON.stringify({ ...base, videoId: '' }) })
    expect(readLastTraining(s1)).toBeNull()
    const { storage: s2 } = makeFakeStorage({ [LAST_TRAINING_KEY]: JSON.stringify({ ...base, videoId: 7 }) })
    expect(readLastTraining(s2)).toBeNull()
    const { storage: s3 } = makeFakeStorage({ [LAST_TRAINING_KEY]: JSON.stringify(base) })
    expect(readLastTraining(s3)).toBeNull()
  })

  it('positionSeconds 为 NaN / 负数 / 字符串时返回 null', () => {
    const mk = (pos: unknown) => {
      const { storage } = makeFakeStorage({
        [LAST_TRAINING_KEY]: JSON.stringify({ version: 1, videoId: 'v1', positionSeconds: pos, updatedAt: 1 }),
      })
      return readLastTraining(storage)
    }
    expect(mk(Number.NaN)).toBeNull()
    expect(mk(-1)).toBeNull()
    expect(mk('12')).toBeNull()
  })

  it('updatedAt 非法时返回 null', () => {
    const { storage } = makeFakeStorage({
      [LAST_TRAINING_KEY]: JSON.stringify({ version: 1, videoId: 'v1', positionSeconds: 12, updatedAt: 'x' }),
    })
    expect(readLastTraining(storage)).toBeNull()
  })

  it('getItem 抛 SecurityError 时返回 null 且不抛', () => {
    const storage = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
      setItem: () => {},
      removeItem: () => {},
    } as unknown as Storage
    expect(() => readLastTraining(storage)).not.toThrow()
    expect(readLastTraining(storage)).toBeNull()
  })

  it('storage 为 null 时读写都安全降级', () => {
    expect(readLastTraining(null)).toBeNull()
    expect(writeLastTraining({ videoId: 'v1', positionSeconds: 5 }, null)).toBe(false)
    expect(() => clearLastTraining(null)).not.toThrow()
  })

  it('setItem 抛 QuotaExceededError 时返回 false 且不抛', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
      removeItem: () => {},
    } as unknown as Storage
    expect(() => writeLastTraining({ videoId: 'v1', positionSeconds: 5 }, storage)).not.toThrow()
    expect(writeLastTraining({ videoId: 'v1', positionSeconds: 5 }, storage)).toBe(false)
  })

  it('setItem 抛 SecurityError 时返回 false', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
      removeItem: () => {},
    } as unknown as Storage
    expect(writeLastTraining({ videoId: 'v1', positionSeconds: 5 }, storage)).toBe(false)
  })

  it('写入参数非法时返回 false', () => {
    const { storage } = makeFakeStorage()
    expect(writeLastTraining({ videoId: '', positionSeconds: 5 }, storage)).toBe(false)
    expect(writeLastTraining({ videoId: 'v1', positionSeconds: -3 }, storage)).toBe(false)
    expect(writeLastTraining({ videoId: 'v1', positionSeconds: Number.NaN }, storage)).toBe(false)
  })

  it('clearLastTraining 清掉记录', () => {
    const { storage, data } = makeFakeStorage()
    writeLastTraining({ videoId: 'v1', positionSeconds: 20 }, storage)
    expect(readLastTraining(storage)).not.toBeNull()
    clearLastTraining(storage)
    expect(data.has(LAST_TRAINING_KEY)).toBe(false)
    expect(readLastTraining(storage)).toBeNull()
  })

  it('removeItem 抛错时 clear 不抛', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
    } as unknown as Storage
    expect(() => clearLastTraining(storage)).not.toThrow()
  })

  it('未注入 storage 时回落到 globalThis.localStorage（无则安全降级）', () => {
    // node 环境没有 localStorage，必须安全返回而不是抛
    expect(() => readLastTraining()).not.toThrow()
    expect(typeof globalThis.localStorage).toBe('undefined')
    expect(readLastTraining()).toBeNull()
    expect(writeLastTraining({ videoId: 'v1', positionSeconds: 30 })).toBe(false)
    expect(() => clearLastTraining()).not.toThrow()
  })

  it('模拟「被移除的视频」：记录仍在，解析正确，由页面决定是否展示', () => {
    const { storage } = makeFakeStorage()
    writeLastTraining({ videoId: 'deleted-video', positionSeconds: 120 }, storage)
    expect(readLastTraining(storage)?.videoId).toBe('deleted-video')
  })
})

describe('isResumablePosition', () => {
  it.each([
    [0, 600, false],
    [4.9, 600, false],
    [5, 600, true],
    [300, 900, true],
    [590, 600, true],
    [590.0001, 600, false],
    [589.999, 600, true],
    [590, 599.999, false],
    [600, 600, false],
    [120, 100, false],
  ])('位置 %s / 时长 %s → %s', (pos, dur, expected) => {
    expect(isResumablePosition(pos, dur)).toBe(expected)
  })

  it('非法输入返回 false', () => {
    expect(isResumablePosition(Number.NaN, 600)).toBe(false)
    expect(isResumablePosition(100, Number.NaN)).toBe(false)
    expect(isResumablePosition(100, 0)).toBe(false)
    expect(isResumablePosition(100, -10)).toBe(false)
  })
})
