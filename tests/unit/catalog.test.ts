import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CATALOG_ENDPOINT,
  describeCatalogError,
  fetchCatalog,
  toCatalogState,
  validateCatalogResponse,
} from '../../src/lib/catalog'
import type { CatalogResponse } from '../../src/lib/types'

function validVideo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    relativePath: 'a/b.mp4',
    title: '示例训练',
    durationSeconds: 620.5,
    types: ['cardio', 'core'],
    level: 'K2',
    hasThumbnail: true,
    thumbnailUrl: '/thumbs/v1.jpg',
    playbackUrl: '/api/stream/v1',
    available: true,
    ...overrides,
  }
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    videos: [validVideo()],
    diagnostics: [
      { path: 'a/x.mp4', kind: 'metadata', message: '缺少难度信息' },
    ],
    generatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('validateCatalogResponse', () => {
  it('合法数据原样通过', () => {
    const result: CatalogResponse = validateCatalogResponse(validPayload())
    expect(result.videos).toHaveLength(1)
    expect(result.videos[0].level).toBe('K2')
    expect(result.diagnostics[0].kind).toBe('metadata')
    expect(result.generatedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('允许空 videos 数组', () => {
    const result = validateCatalogResponse(validPayload({ videos: [] }))
    expect(result.videos).toEqual([])
  })

  it('null / undefined / 字符串 / 数组都抛错', () => {
    expect(() => validateCatalogResponse(null)).toThrow()
    expect(() => validateCatalogResponse(undefined)).toThrow()
    expect(() => validateCatalogResponse('nope')).toThrow()
    expect(() => validateCatalogResponse([validVideo()])).toThrow()
  })

  it('缺 videos 抛错', () => {
    expect(() => validateCatalogResponse({ diagnostics: [], generatedAt: 'x' })).toThrow(/videos/)
  })

  it('videos 不是数组抛错', () => {
    expect(() => validateCatalogResponse(validPayload({ videos: { a: 1 } }))).toThrow(/videos/)
  })

  it('缺 diagnostics 抛错（结构问题不静默通过）', () => {
    expect(() => validateCatalogResponse({ videos: [], generatedAt: 'x' })).toThrow(/diagnostics/)
  })

  it('缺 generatedAt 抛错', () => {
    expect(() => validateCatalogResponse({ videos: [], diagnostics: [] })).toThrow(/generatedAt/)
  })

  it('视频缺字段抛错', () => {
    const v = validVideo()
    delete (v as Record<string, unknown>).title
    expect(() => validateCatalogResponse(validPayload({ videos: [v] }))).toThrow(/title/)
  })

  it('视频字段类型不对抛错', () => {
    expect(() => validateCatalogResponse(validPayload({ videos: [validVideo({ durationSeconds: '600' })] }))).toThrow(
      /durationSeconds/,
    )
    expect(() => validateCatalogResponse(validPayload({ videos: [validVideo({ available: 'yes' })] }))).toThrow(
      /available/,
    )
    expect(() => validateCatalogResponse(validPayload({ videos: [validVideo({ hasThumbnail: 1 })] }))).toThrow(
      /hasThumbnail/,
    )
  })

  it.each(['K1', 'K2', 'K3', 'K4', 'K5'])('合法等级 %s 原样通过', (level) => {
    const result = validateCatalogResponse(validPayload({ videos: [validVideo({ level })] }))
    expect(result.videos[0].level).toBe(level)
  })

  // 等级是人工从课程封面原图识图补齐的。没识别出来 / 填错了，一律归 null ——
  // 绝不猜一个 K 值：60+ 的用户会照着标签去练，错标比不标危险。
  it('缺 level 归一为 null（页面不显示任何等级徽标）', () => {
    const v = validVideo()
    delete (v as Record<string, unknown>).level
    const result = validateCatalogResponse(validPayload({ videos: [v] }))
    expect(result.videos[0].level).toBeNull()
  })

  it.each([['K0'], ['K6'], ['k1'], ['初级'], ['beginner'], [''], [3], [null], [undefined]])(
    '非法 level %s 归一为 null（且不抛错，不影响其余条目）',
    (level) => {
      const result = validateCatalogResponse(
        validPayload({ videos: [validVideo({ level }), validVideo({ id: 'v2', level: 'K5' })] }),
      )
      expect(result.videos[0].level).toBeNull()
      expect(result.videos[1].level).toBe('K5')
    },
  )

  it('level 非法时绝不用任何别的东西兜底推一个 K 值', () => {
    const result = validateCatalogResponse(validPayload({ videos: [validVideo({ level: '乱写' })] }))
    expect(result.videos[0].level).toBeNull()
  })

  it('difficulty 已整体删除：服务端即使还吐这个字段，也不进 Video', () => {
    const raw = validVideo() as Record<string, unknown>
    raw.difficulty = 'beginner'
    const result = validateCatalogResponse(validPayload({ videos: [raw] }))
    expect('difficulty' in result.videos[0]).toBe(false)
  })

  it('非法 types 元素被丢弃（理由：类型标签缺失不该让整个列表打不开）', () => {
    const result = validateCatalogResponse(
      // ⚠️ 不能拿 yoga 当非法值：它现在是 12 类里的合法类型
      validPayload({ videos: [validVideo({ types: ['cardio', 'yoga', 42, null, '不存在的类型'] })] }),
    )
    // 合法的新枚举（yoga）保留，非法值（非字符串 / 不在枚举里）被丢弃
    expect(result.videos[0].types).toEqual(['cardio', 'yoga'])
  })

  it('types 不是数组则抛错', () => {
    expect(() => validateCatalogResponse(validPayload({ videos: [validVideo({ types: 'cardio' })] }))).toThrow(
      /types/,
    )
  })

  it('thumbnailUrl 允许 null，其他类型抛错', () => {
    expect(validateCatalogResponse(validPayload({ videos: [validVideo({ thumbnailUrl: null })] })).videos[0].thumbnailUrl).toBe(
      null,
    )
    expect(() => validateCatalogResponse(validPayload({ videos: [validVideo({ thumbnailUrl: 7 })] }))).toThrow(
      /thumbnailUrl/,
    )
  })

  it('诊断条目 kind 非法抛错', () => {
    expect(() =>
      validateCatalogResponse(
        validPayload({ diagnostics: [{ path: 'p', kind: 'weird', message: 'm' }] }),
      ),
    ).toThrow(/kind/)
  })

  it('错误消息是中文且包含定位信息', () => {
    expect(() => validateCatalogResponse(validPayload({ videos: [validVideo({ title: 1 })] }))).toThrow(
      /videos\[0\]/,
    )
  })
})

describe('fetchCatalog', () => {
  it('成功时校验并返回数据', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(validPayload()), { status: 200 })))
    const result = await fetchCatalog()
    expect(result.videos).toHaveLength(1)
  })

  it('端点是 /api/videos', () => {
    expect(CATALOG_ENDPOINT).toBe('/api/videos')
  })

  it('网络不可达给出中文提示', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed')
    }))
    await expect(fetchCatalog()).rejects.toThrow(/Mac Mini/)
  })

  it('HTTP 错误码带状态码', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 503 })))
    await expect(fetchCatalog()).rejects.toThrow(/503/)
  })

  it('响应不是 JSON 给出中文提示', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })))
    await expect(fetchCatalog()).rejects.toThrow(/不是可识别的数据/)
  })

  it('结构非法时抛出校验错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ videos: 'x' }), { status: 200 })))
    await expect(fetchCatalog()).rejects.toThrow(/videos/)
  })

  it('透传 AbortSignal 的取消异常', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError')
    }))
    await expect(fetchCatalog()).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('toCatalogState', () => {
  it('有视频 → ready，并原样带上 diagnostics 与 generatedAt', () => {
    const payload = validateCatalogResponse(validPayload())
    const state = toCatalogState(payload)
    expect(state).toEqual({
      status: 'ready',
      videos: payload.videos,
      diagnostics: payload.diagnostics,
      generatedAt: payload.generatedAt,
    })
  })

  it('videos 为空数组 → empty（这条约定以前只隐含在 CatalogProvider 里）', () => {
    const payload = validateCatalogResponse(validPayload({ videos: [], diagnostics: [] }))
    expect(toCatalogState(payload)).toEqual({ status: 'empty' })
  })

  it('只有 available:false 的视频仍然算 ready，不是 empty（坏文件不该让整页变成空目录）', () => {
    const payload = validateCatalogResponse(validPayload({ videos: [validVideo({ available: false })] }))
    const state = toCatalogState(payload)
    expect(state.status).toBe('ready')
    expect(state.status === 'ready' && state.videos).toHaveLength(1)
  })

  it('不修改入参，也不复制视频数组', () => {
    const payload = validateCatalogResponse(validPayload())
    const before = JSON.stringify(payload)
    const state = toCatalogState(payload)
    expect(JSON.stringify(payload)).toBe(before)
    expect(state.status === 'ready' && state.videos).toBe(payload.videos)
  })
})

describe('describeCatalogError', () => {
  it('Error 原样返回消息', () => {
    expect(describeCatalogError(new Error('连不上'))).toBe('连不上')
  })

  it('字符串异常被包装', () => {
    expect(describeCatalogError('坏了')).toBe('坏了')
  })

  it('AbortError 返回空串（不弹错误）', () => {
    expect(describeCatalogError(new DOMException('a', 'AbortError'))).toBe('')
  })

  it('未知值有兜底中文', () => {
    expect(describeCatalogError(undefined)).toBeTruthy()
    expect(describeCatalogError({ weird: true })).toBe('视频目录读取失败，请稍后重试。')
  })
})
