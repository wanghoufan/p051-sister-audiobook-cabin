import { describe, expect, it, beforeEach } from 'vitest'
import {
  HISTORY_KEY,
  HISTORY_MAX_ENTRIES,
  HISTORY_MIN_SECONDS,
  HISTORY_VERSION,
  canResume,
  clearHistory,
  historyPercent,
  markCompleted,
  readHistory,
  recordHistory,
  removeHistoryEntry,
} from '../../src/lib/history'
import type { HistoryEntry } from '../../src/lib/history'

/** 内存版 localStorage，行为与浏览器一致（含配额异常时的 setItem 抛错）。 */
function makeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage
}

let store: Storage

beforeEach(() => {
  store = makeStorage()
})

describe('readHistory', () => {
  it('没有记录时返回空数组', () => {
    expect(readHistory(store)).toEqual([])
  })

  it('存储不可用（无痕模式）时返回空数组，不抛异常', () => {
    expect(readHistory(null)).toEqual([])
  })

  it('按 lastPlayedAt 倒序返回（最近练的在前）', () => {
    store.setItem(
      HISTORY_KEY,
      JSON.stringify([
        entry({ videoId: 'old', lastPlayedAt: 1000 }),
        entry({ videoId: 'new', lastPlayedAt: 3000 }),
        entry({ videoId: 'mid', lastPlayedAt: 2000 }),
      ]),
    )
    expect(readHistory(store).map((e) => e.videoId)).toEqual(['new', 'mid', 'old'])
  })

  it('JSON 损坏 / 不是数组 / 版本不符 → 空数组', () => {
    store.setItem(HISTORY_KEY, '{坏掉的 json')
    expect(readHistory(store)).toEqual([])
    store.setItem(HISTORY_KEY, '{"version":1}')
    expect(readHistory(store)).toEqual([])
    store.setItem(HISTORY_KEY, JSON.stringify([{ ...entry(), version: 2 }]))
    expect(readHistory(store)).toEqual([])
  })

  // 关键：单条脏数据不能把整份历史作废。
  // last-training 是「全有或全无」因为它只有一条；这里是列表，容错必须更宽。
  it('单条脏数据被跳过，其余记录照常返回', () => {
    // lastPlayedAt 刻意不同，好同时验证「脏数据被跳过」与「按时间倒序」两件事。
    store.setItem(
      HISTORY_KEY,
      JSON.stringify([
        entry({ videoId: 'good1', lastPlayedAt: 1000 }),
        { videoId: 'bad', positionSeconds: '不是数字' },
        null,
        42,
        entry({ videoId: 'good2', lastPlayedAt: 5000 }),
      ]),
    )
    expect(readHistory(store).map((e) => e.videoId)).toEqual(['good2', 'good1'])
  })
})

describe('recordHistory', () => {
  it('新视频建一条记录，playCount 为 1', () => {
    expect(recordHistory({ videoId: 'v1', positionSeconds: 30, newSession: true }, store)).toBe(true)
    const [only] = readHistory(store)
    expect(only.videoId).toBe('v1')
    expect(only.positionSeconds).toBe(30)
    expect(only.playCount).toBe(1)
    expect(only.completed).toBe(false)
  })

  // upsert 语义：同一视频反复练是更新同一条，不是每次新增一条。
  it('同一 videoId 是 upsert：只保留一条，位置和次数累加', () => {
    recordHistory({ videoId: 'v1', positionSeconds: 30, newSession: true }, store)
    recordHistory({ videoId: 'v1', positionSeconds: 90, newSession: true }, store)
    const list = readHistory(store)
    expect(list).toHaveLength(1)
    expect(list[0].positionSeconds).toBe(90)
    expect(list[0].playCount).toBe(2)
  })

  // 中途存进度不传 newSession，playCount 不该被刷高。
  it('中途存进度（不传 newSession）不增加 playCount', () => {
    recordHistory({ videoId: 'v1', positionSeconds: 30, newSession: true }, store)
    recordHistory({ videoId: 'v1', positionSeconds: 60 }, store)
    recordHistory({ videoId: 'v1', positionSeconds: 90 }, store)
    expect(readHistory(store)[0].playCount).toBe(1)
    expect(readHistory(store)[0].positionSeconds).toBe(90)
  })

  it('firstPlayedAt 首次记录后不再变（要看「第一次什么时候练的」）', () => {
    recordHistory({ videoId: 'v1', positionSeconds: 10, newSession: true }, store)
    const first = readHistory(store)[0].firstPlayedAt
    recordHistory({ videoId: 'v1', positionSeconds: 20, newSession: true }, store)
    expect(readHistory(store)[0].firstPlayedAt).toBe(first)
  })

  it('completed 只升不降：续播一段不会把「练完过」抹掉', () => {
    recordHistory({ videoId: 'v1', positionSeconds: 10, newSession: true }, store)
    recordHistory({ videoId: 'v1', positionSeconds: 0, completed: true }, store)
    expect(readHistory(store)[0].completed).toBe(true)
    recordHistory({ videoId: 'v1', positionSeconds: 50 }, store)
    expect(readHistory(store)[0].completed).toBe(true)
  })

  it('超过上限时丢最久没碰过的那些', () => {
    for (let i = 0; i < HISTORY_MAX_ENTRIES + 20; i += 1) {
      recordHistory({ videoId: `v${i}`, positionSeconds: 10, newSession: true }, store)
    }
    const list = readHistory(store)
    expect(list).toHaveLength(HISTORY_MAX_ENTRIES)
    // 最新的那条一定还在
    expect(list[0].videoId).toBe(`v${HISTORY_MAX_ENTRIES + 19}`)
  })

  it('非法输入（空 id / 负数位置 / NaN）不写', () => {
    expect(recordHistory({ videoId: '', positionSeconds: 10 }, store)).toBe(false)
    expect(recordHistory({ videoId: 'v1', positionSeconds: -1 }, store)).toBe(false)
    expect(recordHistory({ videoId: 'v1', positionSeconds: Number.NaN }, store)).toBe(false)
    expect(readHistory(store)).toEqual([])
  })

  it('存储不可用时返回 false 而不是抛异常', () => {
    expect(recordHistory({ videoId: 'v1', positionSeconds: 10 }, null)).toBe(false)
  })

  it('setItem 抛异常（配额满）时返回 false，不炸', () => {
    const failing: Storage = {
      ...makeStorage(),
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    } as Storage
    expect(recordHistory({ videoId: 'v1', positionSeconds: 10 }, failing)).toBe(false)
  })
})

describe('markCompleted', () => {
  it('把已有记录标成已完成', () => {
    recordHistory({ videoId: 'v1', positionSeconds: 30, newSession: true }, store)
    expect(markCompleted('v1', store)).toBe(true)
    const [only] = readHistory(store)
    expect(only.completed).toBe(true)
    expect(only.playCount).toBe(1)
  })

  // 练完一个目录里没有的 id 不该凭空造一条历史。
  it('记录不存在时静默返回 false，不新建', () => {
    expect(markCompleted('ghost', store)).toBe(false)
    expect(readHistory(store)).toEqual([])
  })
})

describe('removeHistoryEntry / clearHistory', () => {
  it('删掉指定的一条，其余保留', () => {
    recordHistory({ videoId: 'v1', positionSeconds: 10, newSession: true }, store)
    recordHistory({ videoId: 'v2', positionSeconds: 10, newSession: true }, store)
    removeHistoryEntry('v1', store)
    expect(readHistory(store).map((e) => e.videoId)).toEqual(['v2'])
  })

  it('删不存在的 id 静默返回', () => {
    recordHistory({ videoId: 'v1', positionSeconds: 10 }, store)
    removeHistoryEntry('ghost', store)
    expect(readHistory(store)).toHaveLength(1)
  })

  it('clearHistory 清空全部', () => {
    recordHistory({ videoId: 'v1', positionSeconds: 10 }, store)
    recordHistory({ videoId: 'v2', positionSeconds: 10 }, store)
    expect(clearHistory(store)).toBe(true)
    expect(readHistory(store)).toEqual([])
  })

  it('存储不可用时 clearHistory 返回 false、remove 静默', () => {
    expect(clearHistory(null)).toBe(false)
    expect(() => removeHistoryEntry('v1', null)).not.toThrow()
  })
})

describe('canResume', () => {
  const base = entry({ videoId: 'v1', positionSeconds: 60 })

  it('已练完的永远不能「继续」，该显示「再看一遍」', () => {
    expect(canResume({ ...base, completed: true }, 600)).toBe(false)
  })

  it('练到一半（位置 ≥5s 且离结尾 ≥10s）可以继续', () => {
    expect(canResume(base, 600)).toBe(true)
  })

  it('刚开始看（<5s）不显示续播', () => {
    expect(canResume({ ...base, positionSeconds: HISTORY_MIN_SECONDS - 1 }, 600)).toBe(false)
  })

  it('离结尾不足 10s 不显示续播（等于看完了）', () => {
    expect(canResume({ ...base, positionSeconds: 595 }, 600)).toBe(false)
  })

  it('时长非法（0 / NaN）不显示续播', () => {
    expect(canResume(base, 0)).toBe(false)
    expect(canResume(base, Number.NaN)).toBe(false)
  })
})

describe('historyPercent', () => {
  it('练完 = 100%', () => {
    expect(historyPercent(entry({ completed: true }), 600)).toBe(100)
  })

  it('按位置算百分比，并夹在 2–100 之间', () => {
    expect(historyPercent(entry({ positionSeconds: 150 }), 600)).toBe(25)
    expect(historyPercent(entry({ positionSeconds: 1 }), 600)).toBe(2)
    expect(historyPercent(entry({ positionSeconds: 9999 }), 600)).toBe(100)
  })

  it('时长未知且没练完 → 0%（不显示一条空进度条骗人）', () => {
    expect(historyPercent(entry({ positionSeconds: 60 }), 0)).toBe(0)
  })
})

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    version: HISTORY_VERSION,
    videoId: 'v1',
    positionSeconds: 60,
    playCount: 1,
    completed: false,
    firstPlayedAt: 1_000,
    lastPlayedAt: 1_000,
    ...overrides,
  }
}
