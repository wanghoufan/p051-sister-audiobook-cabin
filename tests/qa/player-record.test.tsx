/**
 * QA 回归测试 —— 播放记录（FR-003 / FR-007 / US3）与断网文案（FR-009）。
 *
 * 与 tests/browser/** 的差别：这里专门打边界与竞态 —— 页面隐藏时的兜底写入、
 * ended 之后又被写回、StrictMode 双挂载、A→B 切换时的写入归属、
 * localStorage 抛 SecurityError、记录指向已删除视频。
 *
 * 历史：缺陷 M-1（persist 绕过「已开始播放」门禁，导致只打开播放页就切后台会用
 * currentTime=0 覆盖掉上一次训练）当初用三条 it.fails 锁住，修好之后已全部改回 it，
 * 现在是必须通过的状态的回归守卫。
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { StrictMode } from 'react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import type { NavigateFunction } from 'react-router-dom'

import { App } from '../../src/App'
import { CatalogProvider } from '../../src/components/CatalogProvider'
import { LAST_TRAINING_KEY } from '../../src/lib/last-training'
import type { CatalogResponse, Video } from '../../src/lib/types'

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: 'a'.repeat(16),
    relativePath: 'Keep/01 4 分钟 Tabata.mp4',
    title: '4 分钟 Tabata 燃脂急救',
    durationSeconds: 600,
    types: ['cardio'],
    level: 'K2',
    hasThumbnail: true,
    thumbnailUrl: '/api/videos/aaaaaaaaaaaaaaa/thumbnail',
    playbackUrl: '/api/videos/aaaaaaaaaaaaaaa/stream',
    available: true,
    ...overrides,
  }
}

function payload(videos: Video[]): CatalogResponse {
  return { videos, diagnostics: [], generatedAt: '2026-01-01T00:00:00.000Z' }
}

function stubFetch(body: unknown, ok = true): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }))
  vi.stubGlobal('fetch', fn)
  return fn
}

function stored(): { videoId: string; positionSeconds: number } | null {
  const raw = window.localStorage.getItem(LAST_TRAINING_KEY)
  if (raw === null) return null
  return JSON.parse(raw) as { videoId: string; positionSeconds: number }
}

function setStored(rec: unknown): void {
  window.localStorage.setItem(LAST_TRAINING_KEY, JSON.stringify(rec))
}

function media(): HTMLVideoElement {
  return document.querySelector('video') as HTMLVideoElement
}

async function renderPlayer(route: string, videos: Video[]): Promise<HTMLVideoElement> {
  stubFetch(payload(videos))
  render(
    <MemoryRouter initialEntries={[route]}>
      <CatalogProvider>
        <App />
      </CatalogProvider>
    </MemoryRouter>,
  )
  await screen.findByText('4 分钟 Tabata 燃脂急救')
  return media()
}

let navigate: NavigateFunction
function NavSpy() {
  navigate = useNavigate()
  return null
}

/** 渲染一次真实 App，并返回在同一个 CatalogProvider / VideoPlayer 实例内导航的能力。 */
async function renderApp(route: string, videos: Video[]) {
  stubFetch(payload(videos))
  render(
    <MemoryRouter initialEntries={[route]}>
      <CatalogProvider>
        <NavSpy />
        <App />
      </CatalogProvider>
    </MemoryRouter>,
  )
  return async (to: string) => {
    await act(async () => {
      navigate(to)
    })
  }
}

/** 模拟「时间过去了 1 分钟」，让节流条件（10s / 3s）一定放行。 */
function tickClock(ms: number): void {
  vi.setSystemTime(Date.now() + ms)
}

/**
 * jsdom 里 document.visibilityState 恒为 'visible'，切后台/切回前台必须显式改写，
 * 否则「只在 hidden 时保存」这条逻辑在测试里永远走不到。
 */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  Object.defineProperty(document, 'hidden', { configurable: true, value: state === 'hidden' })
}

let playSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z').getTime())
  window.localStorage.clear()
  setVisibility('visible')
  playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('FR-007 播放记录写入时机', () => {
  it('播放后 timeupdate 会写记录（videoId 与位置正确）', async () => {
    const v = video()
    const el = await renderPlayer(`/video/${v.id}`, [v])
    act(() => {
      el.currentTime = 42
    })
    fireEvent.play(el)
    tickClock(11_000)
    fireEvent.timeUpdate(el)
    expect(stored()).toEqual({ videoId: v.id, positionSeconds: 42, version: 1, updatedAt: expect.any(Number) })
  })

  it('没有 play 事件时 timeupdate 不写（严格遵守「开始播放后才记录」）', async () => {
    const v = video()
    const el = await renderPlayer(`/video/${v.id}`, [v])
    act(() => {
      el.currentTime = 42
    })
    tickClock(11_000)
    fireEvent.timeUpdate(el)
    expect(stored()).toBeNull()
  })

  // 回归守卫（缺陷 M-1 已修）：没播放过就完全不该动记录。
  it('【M-1 回归】只打开播放页、从未播放，离开页面（pagehide）不写记录，上一次训练的进度原封不动', async () => {
    const a = video()
    const b = video({ id: 'b'.repeat(16), title: '另一个视频', playbackUrl: '/api/videos/b/stream' })
    // 已有有效记录：视频 A 看到 120 秒
    setStored({ version: 1, videoId: a.id, positionSeconds: 120, updatedAt: 1 })

    stubFetch(payload([a, b]))
    render(
      <MemoryRouter initialEntries={[`/video/${b.id}`]}>
        <CatalogProvider>
          <App />
        </CatalogProvider>
      </MemoryRouter>,
    )
    await screen.findByText('另一个视频')
    // 让 effect 一定已经挂上 pagehide / visibilitychange 监听（机器负载高时
    // findByText 之后的被动 effect 可能还没 flush，不加这一步会偶发测不到缺陷）
    await act(async () => {
      await Promise.resolve()
    })
    const el = media()
    // 关键：全程没有 fireEvent.play，也没有设置 currentTime —— 用户只是点开看了一眼就返回
    expect(el.currentTime).toBe(0)
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })

    // 期望：没播放过就完全不该动记录
    expect(stored()).toMatchObject({ videoId: a.id, positionSeconds: 120 })
  }, 20_000)

  it('【M-1 回归】只打开播放页、从未播放，切后台（visibilitychange）不新增任何记录', async () => {
    const a = video()
    const b = video({ id: 'b'.repeat(16), title: '另一个视频', playbackUrl: '/api/videos/b/stream' })
    setStored({ version: 1, videoId: a.id, positionSeconds: 120, updatedAt: 1 })

    stubFetch(payload([a, b]))
    render(
      <MemoryRouter initialEntries={[`/video/${b.id}`]}>
        <CatalogProvider>
          <App />
        </CatalogProvider>
      </MemoryRouter>,
    )
    await screen.findByText('另一个视频')
    await act(async () => {
      await Promise.resolve()
    })
    const el = media()
    expect(el.currentTime).toBe(0)
    setVisibility('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    // 既不会覆盖 A 的记录，也不会凭空多出 B 的记录
    expect(stored()).toMatchObject({ videoId: a.id, positionSeconds: 120 })
    expect(stored()?.positionSeconds).not.toBe(0)
  }, 20_000)

  it('【M-1 回归】点开看了一眼（不播放）再回首页，「上次训练」仍然指向 A', async () => {
    const a = video()
    const b = video({ id: 'b'.repeat(16), title: '另一个视频', playbackUrl: '/api/videos/b/stream' })
    setStored({ version: 1, videoId: a.id, positionSeconds: 120, updatedAt: 1 })
    const go = await renderApp('/', [a, b])
    expect(await screen.findByText('上次训练')).toBeInTheDocument()

    // 复现缺陷路径：点开 B 看一眼（不播放）→ 返回首页
    await go(`/video/${b.id}`)
    await screen.findByText('另一个视频')
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    await go('/')
    await waitFor(() => expect(document.querySelector('.video-grid')).toBeInTheDocument())
    // 期望：只是「点开看了一眼」，首页的上次训练仍然指向 A
    expect(screen.getByText('上次训练')).toBeInTheDocument()
  }, 20_000)

  it('切回前台（visibilitychange 但未 hidden）不触发写入', async () => {
    const v = video()
    const el = await renderPlayer(`/video/${v.id}`, [v])
    act(() => {
      el.currentTime = 30
    })
    fireEvent.play(el)
    act(() => {
      el.currentTime = 60
    })
    fireEvent.timeUpdate(el) // 先正常写一条 60
    expect(stored()?.positionSeconds).toBe(60)
    act(() => {
      el.currentTime = 90
    })
    setVisibility('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(stored()?.positionSeconds).toBe(60)
  }, 20_000)

  it('visibilitychange（切后台）会把正在播放的真实位置写进记录', async () => {
    const v = video()
    const el = await renderPlayer(`/video/${v.id}`, [v])
    act(() => {
      el.currentTime = 88
    })
    fireEvent.play(el)
    setVisibility('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(stored()).toMatchObject({ videoId: v.id, positionSeconds: 88 })
  })

  it('切到后台时已经在播放 → 记录被正确更新为真实位置（不是被清零）', async () => {
    const v = video()
    const el = await renderPlayer(`/video/${v.id}`, [v])
    setStored({ version: 1, videoId: 'c'.repeat(16), positionSeconds: 120, updatedAt: 1 })
    act(() => {
      el.currentTime = 88
    })
    fireEvent.play(el)
    act(() => {
      el.currentTime = 150
    })
    fireEvent.timeUpdate(el)
    expect(stored()).toMatchObject({ videoId: v.id, positionSeconds: 150 })

    setVisibility('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(stored()).toMatchObject({ videoId: v.id, positionSeconds: 150 })
  })
})

describe('FR-007 播完之后归零', () => {
  it('ended 真的调用了 clearLastTraining（存储被清空）', async () => {
    const v = video()
    const el = await renderPlayer(`/video/${v.id}`, [v])
    act(() => {
      el.currentTime = 600
    })
    fireEvent.play(el)
    tickClock(11_000)
    fireEvent.timeUpdate(el)
    expect(stored()).not.toBeNull()

    fireEvent.ended(el)
    expect(window.localStorage.getItem(LAST_TRAINING_KEY)).toBeNull()
  })

  it('ended 之后再来的 timeupdate 不会把记录写回来', async () => {
    const v = video()
    const el = await renderPlayer(`/video/${v.id}`, [v])
    act(() => {
      el.currentTime = 600
    })
    fireEvent.play(el)
    tickClock(11_000)
    fireEvent.timeUpdate(el)
    fireEvent.ended(el)

    tickClock(30_000)
    act(() => {
      el.currentTime = 600
    })
    fireEvent.timeUpdate(el) // hasPlayedRef 已被 ended 置 false
    expect(window.localStorage.getItem(LAST_TRAINING_KEY)).toBeNull()
  })

  // 回归守卫（缺陷已修）：ended 之后任何写入路径都不该把记录写回来。
  it('【M-1 回归】ended 之后若浏览器再派发 pause，也不会把「结尾位置」写回记录', async () => {
    // 本地无法确定 Chrome / 安卓 WebView 在 ended 之后是否还会派发 pause，
    // 所以这里锁住「如果发生了会怎样」：现在什么都不会发生。
    const v = video()
    const el = await renderPlayer(`/video/${v.id}`, [v])
    act(() => {
      el.currentTime = 600
    })
    fireEvent.play(el)
    tickClock(11_000)
    fireEvent.timeUpdate(el)
    expect(stored()).not.toBeNull()
    fireEvent.ended(el)
    expect(window.localStorage.getItem(LAST_TRAINING_KEY)).toBeNull()

    fireEvent.pause(el) // 假设浏览器在 ended 之后补一个 pause
    // 期望：ended 之后不该再写回任何位置
    expect(stored()).toBeNull()
  })

  it('【M-1 回归】ended 之后再切后台（pagehide / visibilitychange）也不会写回垃圾记录', async () => {
    const v = video()
    const el = await renderPlayer(`/video/${v.id}`, [v])
    act(() => {
      el.currentTime = 600
    })
    fireEvent.play(el)
    tickClock(11_000)
    fireEvent.timeUpdate(el)
    fireEvent.ended(el)
    expect(window.localStorage.getItem(LAST_TRAINING_KEY)).toBeNull()

    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    setVisibility('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(stored()).toBeNull()
  })

  it('播完后再按播放 → 回到 0 开始重看，结尾位置不会被当成进度写回', async () => {
    const v = video()
    const el = await renderPlayer(`/video/${v.id}`, [v])
    act(() => {
      el.currentTime = 600
    })
    fireEvent.play(el)
    fireEvent.ended(el)
    expect(stored()).toBeNull()

    // 用户按了原生控件的重播
    fireEvent.play(el)
    expect(el.currentTime).toBe(0)

    act(() => {
      el.currentTime = 30
    })
    tickClock(11_000)
    fireEvent.timeUpdate(el)
    // 记的是重看后的新进度，而不是结尾位置
    expect(stored()).toMatchObject({ videoId: v.id, positionSeconds: 30 })
  })
})

describe('从头播放按钮', () => {
  it('把 currentTime 归 0、清掉记录、并再次调用 play()', async () => {
    const v = video()
    setStored({ version: 1, videoId: v.id, positionSeconds: 300, updatedAt: 1 })
    const el = await renderPlayer(`/video/${v.id}?resume=1`, [v])
    act(() => {
      el.currentTime = 0
    })
    fireEvent.loadedMetadata(el)
    expect(el.currentTime).toBe(300) // 续播生效

    playSpy.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '从头播放' }))
    expect(el.currentTime).toBe(0)
    expect(window.localStorage.getItem(LAST_TRAINING_KEY)).toBeNull()
    expect(playSpy).toHaveBeenCalled()
  })

  it('从头播放之后正常播放会重新建立记录（不会被永久清零）', async () => {
    const v = video()
    setStored({ version: 1, videoId: v.id, positionSeconds: 300, updatedAt: 1 })
    const el = await renderPlayer(`/video/${v.id}?resume=1`, [v])
    act(() => {
      el.currentTime = 0
    })
    fireEvent.loadedMetadata(el)
    fireEvent.click(screen.getByRole('button', { name: '从头播放' }))

    act(() => {
      el.currentTime = 20
    })
    fireEvent.play(el)
    tickClock(11_000)
    fireEvent.timeUpdate(el)
    expect(stored()).toMatchObject({ videoId: v.id, positionSeconds: 20 })
  })
})

describe('记录失效与异常兜底（US3 第 2/4 条）', () => {
  it('记录指向已删除的视频 → 首页整个「上次训练」区域不渲染', async () => {
    const a = video()
    setStored({ version: 1, videoId: 'f'.repeat(16), positionSeconds: 120, updatedAt: 1 })
    stubFetch(payload([a]))
    render(
      <MemoryRouter initialEntries={['/']}>
        <CatalogProvider>
          <App />
        </CatalogProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.querySelector('.video-grid')).toBeInTheDocument())
    expect(screen.queryByText('上次训练')).toBeNull()
  })

  it('记录指向 available:false 的视频 → 区域不渲染', async () => {
    const a = video({ available: false })
    setStored({ version: 1, videoId: a.id, positionSeconds: 120, updatedAt: 1 })
    stubFetch(payload([a]))
    render(
      <MemoryRouter initialEntries={['/']}>
        <CatalogProvider>
          <App />
        </CatalogProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.querySelector('.video-grid')).toBeInTheDocument())
    expect(screen.queryByText('上次训练')).toBeNull()
  })

  it('localStorage 抛 SecurityError（无痕模式）→ 页面照常渲染播放器与视频列表', async () => {
    const realDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')!
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    try {
      const v = video()
      stubFetch(payload([v]))
      render(
        <MemoryRouter initialEntries={[`/video/${v.id}`]}>
          <CatalogProvider>
            <App />
          </CatalogProvider>
        </MemoryRouter>,
      )
      await screen.findByText('4 分钟 Tabata 燃脂急救')
      const el = media()
      expect(el).toBeTruthy()
      expect(el.getAttribute('src')).toBe(v.playbackUrl)
      // 抛异常也不能让 effect 冒泡成未捕获错误
      act(() => {
        el.currentTime = 30
      })
      fireEvent.play(el)
      tickClock(11_000)
      expect(() => fireEvent.timeUpdate(el)).not.toThrow()
      expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow()
    } finally {
      Object.defineProperty(window, 'localStorage', realDescriptor)
    }
  }, 20_000)

  it('localStorage 里是损坏的 JSON → 区域不渲染，页面正常', async () => {
    window.localStorage.setItem(LAST_TRAINING_KEY, '{ 这不是 json')
    const a = video()
    stubFetch(payload([a]))
    render(
      <MemoryRouter initialEntries={['/']}>
        <CatalogProvider>
          <App />
        </CatalogProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.querySelector('.video-grid')).toBeInTheDocument())
    expect(screen.queryByText('上次训练')).toBeNull()
  })

  for (const [label, pos] of [
    ['刚开始看（4.9 秒）', 4.9],
    ['快看完了（距结尾 9 秒）', 591],
  ] as [string, number][]) {
    it(`记录位置${label} → 不提示续播`, async () => {
      const a = video()
      setStored({ version: 1, videoId: a.id, positionSeconds: pos, updatedAt: 1 })
      stubFetch(payload([a]))
      render(
        <MemoryRouter initialEntries={['/']}>
          <CatalogProvider>
            <App />
          </CatalogProvider>
        </MemoryRouter>,
      )
      await screen.findByText('4 分钟 Tabata 燃脂急救')
      expect(screen.queryByText('上次训练')).toBeNull()
    }, 20_000)
  }
})

describe('并发与 StrictMode', () => {
  it('A→B 切换后，timeupdate 写到的是 B 的 id，不会把 A 的进度写到 B 名下', async () => {
    const a = video()
    const b = video({ id: 'b'.repeat(16), title: '视频 B', playbackUrl: '/api/videos/b/stream' })
    setStored({ version: 1, videoId: a.id, positionSeconds: 200, updatedAt: 1 })
    const go = await renderApp(`/video/${a.id}`, [a, b])
    await screen.findByText('4 分钟 Tabata 燃脂急救')
    act(() => {
      media().currentTime = 200
    })
    fireEvent.play(media())

    // 切到 B（同一个 VideoPlayer 组件实例，id 参数变化）
    await go(`/video/${b.id}`)
    await screen.findByText('视频 B')
    const el = media()
    act(() => {
      el.currentTime = 15
    })
    fireEvent.play(el)
    tickClock(11_000)
    fireEvent.timeUpdate(el)
    expect(stored()).toMatchObject({ videoId: b.id, positionSeconds: 15 })
  }, 20_000)

  it('StrictMode 双挂载下，播放记录只被写一次（不因双 effect 写两条）', async () => {
    const v = video()
    stubFetch(payload([v]))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(
      <StrictMode>
        <MemoryRouter initialEntries={[`/video/${v.id}`]}>
          <CatalogProvider>
            <App />
          </CatalogProvider>
        </MemoryRouter>
      </StrictMode>,
    )
    await screen.findByText('4 分钟 Tabata 燃脂急救')
    const el = media()
    act(() => {
      el.currentTime = 50
    })
    fireEvent.play(el)
    tickClock(11_000)
    fireEvent.timeUpdate(el)
    const writes = setItem.mock.calls.filter(([k]) => k === LAST_TRAINING_KEY)
    expect(writes).toHaveLength(1)
    expect(stored()).toMatchObject({ videoId: v.id, positionSeconds: 50 })
  }, 20_000)

  it('StrictMode 双挂载下，ended 清除记录不会抛错也不会写回', async () => {
    const v = video()
    setStored({ version: 1, videoId: v.id, positionSeconds: 400, updatedAt: 1 })
    stubFetch(payload([v]))
    render(
      <StrictMode>
        <MemoryRouter initialEntries={[`/video/${v.id}`]}>
          <CatalogProvider>
            <App />
          </CatalogProvider>
        </MemoryRouter>
      </StrictMode>,
    )
    await screen.findByText('4 分钟 Tabata 燃脂急救')
    act(() => {
      media().currentTime = 600
    })
    expect(() => fireEvent.ended(media())).not.toThrow()
    expect(window.localStorage.getItem(LAST_TRAINING_KEY)).toBeNull()
  }, 20_000)
})

describe('FR-009 断网 / 后端挂掉时的文案', () => {
  it('fetch 直接 reject（断网 / Mac 关机）→ 首页显示中文提示与 Wi-Fi 指引', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed to fetch') }))
    render(
      <MemoryRouter initialEntries={['/']}>
        <CatalogProvider>
          <App />
        </CatalogProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('暂时看不到视频')).toBeInTheDocument()
    expect(screen.getByText(/Mac Mini 已开机/)).toBeInTheDocument()
    expect(screen.getByText(/Wi-Fi/)).toBeInTheDocument()
  }, 20_000)

  it('播放页断网同样给出可理解的提示，而不是白屏', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed to fetch') }))
    render(
      <MemoryRouter initialEntries={['/video/whatever']}>
        <CatalogProvider>
          <App />
        </CatalogProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('暂时看不到视频')).toBeInTheDocument()
  }, 20_000)

  it('后端返回 500 → 显示带状态码的中文提示', async () => {
    stubFetch({ error: 'scan_failed' }, false)
    render(
      <MemoryRouter initialEntries={['/']}>
        <CatalogProvider>
          <App />
        </CatalogProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText(/视频服务返回了 500 错误/)).toBeInTheDocument()
  }, 20_000)

  it('后端返回非 JSON → 提示「不是可识别的数据」', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <')
        },
      })),
    )
    render(
      <MemoryRouter initialEntries={['/']}>
        <CatalogProvider>
          <App />
        </CatalogProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText(/不是可识别的数据/)).toBeInTheDocument()
  }, 20_000)

  it('videos 为空数组 → empty 态（不给用户一个空白页）', async () => {
    stubFetch(payload([]))
    render(
      <MemoryRouter initialEntries={['/']}>
        <CatalogProvider>
          <App />
        </CatalogProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('视频目录里还没有可播放的视频')).toBeInTheDocument()
  }, 20_000)
})
