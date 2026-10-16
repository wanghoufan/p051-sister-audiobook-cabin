import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readHistory } from '../../src/lib/history'
import {
  makePayload,
  makeVideo,
  readStoredLastTraining,
  renderApp,
  seedLastTraining,
  stubCatalogFetch,
} from './helpers'

const VIDEO = makeVideo({ id: 'v1', durationSeconds: 600, playbackUrl: '/api/stream/v1' })

let playSpy: ReturnType<typeof vi.spyOn>
// 播放记录的节流依赖 Date.now()，把时钟固定住，测试就不会因为机器卡顿而误判。
const CLOCK_START = new Date('2026-01-01T00:00:00.000Z').getTime()

function advanceClock(ms: number) {
  vi.setSystemTime(Date.now() + ms)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(CLOCK_START)
  window.localStorage.clear()
  stubCatalogFetch(makePayload([VIDEO, makeVideo({ id: 'v2', title: '另一个' })]))
  playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function media(): HTMLVideoElement {
  return document.querySelector('video') as HTMLVideoElement
}

/** 播放器的取景框（.player__frame），真实比例的 CSS 变量写在这个元素上。 */
function frame(): HTMLElement {
  const el = document.querySelector('.player__frame')
  if (!el) throw new Error('没找到 .player__frame')
  return el as HTMLElement
}

/**
 * jsdom 不实现媒体解码，videoWidth/videoHeight 恒为 0。
 * 这里手动定义成真实素材的尺寸（本库 130 个视频全是 1080×2460 竖版）。
 */
function setVideoSize(video: HTMLVideoElement, w: number, h: number) {
  for (const [name, value] of [['videoWidth', w], ['videoHeight', h]] as const) {
    Object.defineProperty(video, name, { value, configurable: true })
  }
}

async function ready(route: string) {
  renderApp(route)
  await screen.findByText('4 分钟 Tabata 燃脂急救')
  return media()
}

describe('VideoPlayer', () => {
  it('渲染原生控件、playsInline、不自动播放', async () => {
    await ready('/video/v1')
    const video = media()
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('playsinline')
    expect(video).not.toHaveAttribute('autoplay')
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(video.getAttribute('src')).toBe('/api/stream/v1')
    expect(video).toHaveAttribute('poster', '/api/thumb/v1.jpg')
  })

  it('带 ?resume=1 时在 loadedmetadata 后设置 currentTime 并提示', async () => {
    seedLastTraining('v1', 120)
    const video = await ready('/video/v1?resume=1')
    act(() => {
      video.currentTime = 0
    })
    fireEvent.loadedMetadata(video)
    expect(video.currentTime).toBe(120)
    expect(screen.getByText(/已从 2:00 继续播放/)).toBeInTheDocument()
  })

  it('没有 ?resume=1 时不自动跳位置', async () => {
    seedLastTraining('v1', 120)
    const video = await ready('/video/v1')
    act(() => {
      video.currentTime = 0
    })
    fireEvent.loadedMetadata(video)
    expect(video.currentTime).toBe(0)
    expect(screen.queryByText(/已从/)).not.toBeInTheDocument()
  })

  it('从头播放按钮把 currentTime 置 0、调用 play 并清掉记录', async () => {
    seedLastTraining('v1', 120)
    const video = await ready('/video/v1?resume=1')
    act(() => {
      video.currentTime = 0
    })
    fireEvent.loadedMetadata(video)
    expect(video.currentTime).toBe(120)

    fireEvent.click(screen.getByRole('button', { name: '从头播放' }))
    expect(video.currentTime).toBe(0)
    expect(playSpy).toHaveBeenCalled()
    expect(readStoredLastTraining()).toBeNull()
    expect(screen.queryByText(/已从/)).not.toBeInTheDocument()
  })

  it('只有真正开始播放后才写记录，播放中按节流写', async () => {
    const video = await ready('/video/v1')
    // 挂载后没有 play 事件：不该有任何记录
    act(() => {
      video.currentTime = 5
    })
    fireEvent.timeUpdate(video)
    expect(readStoredLastTraining()).toBeNull()

    fireEvent.play(video)
    // 第一次 timeupdate：还没有任何写入，位置已 > 0 → 写入第一条记录
    act(() => {
      video.currentTime = 6
    })
    fireEvent.timeUpdate(video)
    expect(readStoredLastTraining()).toEqual({ videoId: 'v1', positionSeconds: 6 })

    // 位置只变化 2 秒（< 3）→ 挡掉
    act(() => {
      video.currentTime = 8
    })
    fireEvent.timeUpdate(video)
    expect(readStoredLastTraining()?.positionSeconds).toBe(6)

    // 位置变化够大但距上次写入不足 10 秒 → 挡掉
    act(() => {
      video.currentTime = 30
    })
    fireEvent.timeUpdate(video)
    expect(readStoredLastTraining()?.positionSeconds).toBe(6)

    // pause 时立即补写
    fireEvent.pause(video)
    expect(readStoredLastTraining()).toEqual({ videoId: 'v1', positionSeconds: 30 })
  })

  it('10 秒内不再变化则节流，pause 时立即补写', async () => {
    const video = await ready('/video/v1')
    fireEvent.play(video)
    act(() => {
      video.currentTime = 100
    })
    fireEvent.timeUpdate(video)
    expect(readStoredLastTraining()?.positionSeconds).toBe(100)

    act(() => {
      video.currentTime = 140
    })
    fireEvent.timeUpdate(video)
    expect(readStoredLastTraining()?.positionSeconds).toBe(100)

    // 超过 10 秒后再来一次 timeUpdate → 允许写入
    advanceClock(11_000)
    act(() => {
      video.currentTime = 200
    })
    fireEvent.timeUpdate(video)
    expect(readStoredLastTraining()?.positionSeconds).toBe(200)

    fireEvent.pause(video)
    expect(readStoredLastTraining()?.positionSeconds).toBe(200)
  })

  it('播完 ended → last-training 被清除，但「历史」里这条保留并标完成', async () => {
    const video = await ready('/video/v1')
    fireEvent.play(video)
    act(() => {
      video.currentTime = 600
    })
    fireEvent.timeUpdate(video)
    expect(readStoredLastTraining()).not.toBeNull()
    expect(readHistory()).toHaveLength(1)

    fireEvent.ended(video)
    // last-training 清掉 → 首页不再提示续播一个已经练完的课
    expect(readStoredLastTraining()).toBeNull()
    // 但「练过这条」必须留着 —— 用户要的就是这份名单
    const entries = readHistory()
    expect(entries).toHaveLength(1)
    expect(entries[0].videoId).toBe('v1')
    expect(entries[0].completed).toBe(true)
  })

  // 产品需求：只要练过就有记录，练到一半退出也算。
  it('练到一半退出 → 历史里有记录，标着「未练完」', async () => {
    const video = await ready('/video/v1')
    fireEvent.play(video)
    act(() => {
      video.currentTime = 150
    })
    fireEvent.timeUpdate(video)
    fireEvent.pause(video)

    const entries = readHistory()
    expect(entries).toHaveLength(1)
    expect(entries[0].positionSeconds).toBe(150)
    expect(entries[0].completed).toBe(false)
  })

  it('只打开播放页、从未播放 → 历史里不产生记录', async () => {
    const video = await ready('/video/v1')
    act(() => {
      video.currentTime = 8
    })
    fireEvent.timeUpdate(video)
    expect(readHistory()).toEqual([])
  })

  it('同一视频练两次 → 历史里仍是一条，playCount 累加到 2', async () => {
    const first = await ready('/video/v1')
    fireEvent.play(first)
    act(() => {
      first.currentTime = 100
    })
    fireEvent.timeUpdate(first)
    fireEvent.pause(first)

    // 必须先卸载再重新渲染：两次 renderApp 会叠加出两个组件实例，
    // 而 media() 取的是 document 里第一个 <video>，事件会打到旧实例上。
    cleanup()
    const second = await ready('/video/v1')
    fireEvent.play(second)
    act(() => {
      second.currentTime = 200
    })
    fireEvent.timeUpdate(second)
    fireEvent.pause(second)

    const entries = readHistory()
    expect(entries).toHaveLength(1)
    expect(entries[0].playCount).toBe(2)
    expect(entries[0].positionSeconds).toBe(200)
  })

  it('视频 error 事件 → 显示中文提示与返回首页，不崩溃', async () => {
    const video = await ready('/video/v1')
    fireEvent.error(video)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('这个视频可能已被移除或文件损坏')
    expect(within(alert).getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/')
  })

  it('id 不存在 → 提示 + 返回首页', async () => {
    renderApp('/video/nope')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('找不到这个视频')
    expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/')
  })

  it('展示标题、类型、等级、时长与相对路径', async () => {
    await ready('/video/v1')
    expect(screen.getByText('有氧')).toBeInTheDocument()
    expect(screen.getByText('K2')).toBeInTheDocument()
    expect(screen.getByText('时长 10:00')).toBeInTheDocument()
    expect(screen.getByText('Keep/01 4 分钟 Tabata.mp4')).toBeInTheDocument()
  })

  it('等级为 null 时不显示任何等级徽标（与卡片页保持一致）', async () => {
    // 换一份 level=null 的目录再渲染，验证播放页与卡片页对「没识别出来」的处理完全一致
    stubCatalogFetch(makePayload([makeVideo({ id: 'v1', durationSeconds: 600, level: null })]))
    await ready('/video/v1')
    expect(document.querySelector('.level')).toBeNull()
    expect(screen.queryByText(/待标注/)).not.toBeInTheDocument()
  })
})

/**
 * 必修项 1：竖版视频在 16:9 容器里横向只剩 25%（实测 361×203 的盒子里装 1080×2460
 * 的画面，可见区只有 89×203）。修法是 loadedmetadata 时把 videoWidth/videoHeight
 * 写进 --player-ratio，让盒子按真实比例走。
 *
 * 为什么这组断言查的是 CSS 变量而不是盒子尺寸：jsdom 不实现 CSS 布局，
 * getBoundingClientRect() 永远返回 0×0，aspect-ratio / object-fit 一条都算不出来。
 * 变量是 JS 侧真正写下去的那份数据，浏览器实测由 qa-report 补上。
 */
describe('VideoPlayer 取景框比例（--player-ratio）', () => {
  beforeEach(() => {
    window.localStorage.clear()
    stubCatalogFetch(makePayload([VIDEO, makeVideo({ id: 'v2', title: '另一个' })]))
  })

  it('loadedmetadata 时把真实 videoWidth/videoHeight 写进 --player-ratio', async () => {
    const video = await ready('/video/v1')
    expect(frame().style.getPropertyValue('--player-ratio')).toBe('')

    setVideoSize(video, 1080, 2460)
    fireEvent.loadedMetadata(video)

    // 必须是 "宽 / 高" 的形式：CSS 的 aspect-ratio 直接吃这个语法
    expect(frame().style.getPropertyValue('--player-ratio')).toBe('1080 / 2460')
  })

  it('横版素材同样按真实比例写，不做「竖版特判」', async () => {
    const video = await ready('/video/v1')
    setVideoSize(video, 1920, 1080)
    fireEvent.loadedMetadata(video)
    expect(frame().style.getPropertyValue('--player-ratio')).toBe('1920 / 1080')
  })

  it('非整数尺寸也不会被取整成错的比例', async () => {
    const video = await ready('/video/v1')
    setVideoSize(video, 1080, 1921)
    fireEvent.loadedMetadata(video)
    expect(frame().style.getPropertyValue('--player-ratio')).toBe('1080 / 1921')
  })

  it('尺寸还没拿到（readyState=0，videoWidth=0）时不写变量，交给 CSS 兜底', async () => {
    const video = await ready('/video/v1')
    // 不调 setVideoSize：jsdom 默认 videoWidth/videoHeight 都是 0
    expect(video.videoWidth).toBe(0)
    expect(video.videoHeight).toBe(0)

    fireEvent.loadedMetadata(video)

    // 不能写 `0 / 0`（会让 aspect-ratio 失效退化成 auto，盒子塌成一条线）
    expect(frame().style.getPropertyValue('--player-ratio')).toBe('')
  })

  it('尺寸非法（0 宽、NaN）时同样不写变量', async () => {
    const video = await ready('/video/v1')
    setVideoSize(video, 0, 2460)
    fireEvent.loadedMetadata(video)
    expect(frame().style.getPropertyValue('--player-ratio')).toBe('')

    setVideoSize(video, Number.NaN, 2460)
    fireEvent.loadedMetadata(video)
    expect(frame().style.getPropertyValue('--player-ratio')).toBe('')
  })

  it('比例同步与续播互不干扰：没有 ?resume=1 也照样写比例', async () => {
    seedLastTraining('v1', 120)
    const video = await ready('/video/v1')
    act(() => {
      video.currentTime = 0
    })
    setVideoSize(video, 1080, 2460)
    fireEvent.loadedMetadata(video)

    expect(frame().style.getPropertyValue('--player-ratio')).toBe('1080 / 2460')
    expect(video.currentTime).toBe(0) // 没带 resume，不该跳位置
  })

  it('带 ?resume=1 时比例与续播位置同时生效（两条逻辑共存，不是二选一）', async () => {
    seedLastTraining('v1', 120)
    const video = await ready('/video/v1?resume=1')
    act(() => {
      video.currentTime = 0
    })
    setVideoSize(video, 1080, 2460)
    fireEvent.loadedMetadata(video)

    expect(frame().style.getPropertyValue('--player-ratio')).toBe('1080 / 2460')
    expect(video.currentTime).toBe(120)
    expect(screen.getByText(/已从 2:00 继续播放/)).toBeInTheDocument()
  })

  it('同一个视频重复触发 loadedmetadata 不会互相覆盖（续播只生效一次，比例幂等）', async () => {
    seedLastTraining('v1', 120)
    const video = await ready('/video/v1?resume=1')
    act(() => {
      video.currentTime = 0
    })
    setVideoSize(video, 1080, 2460)
    fireEvent.loadedMetadata(video)
    expect(video.currentTime).toBe(120)

    // 第二次：比例照样是同一个值，续播位置不被重置
    act(() => {
      video.currentTime = 300
    })
    fireEvent.loadedMetadata(video)
    expect(frame().style.getPropertyValue('--player-ratio')).toBe('1080 / 2460')
    expect(video.currentTime).toBe(300)
  })

  it('换一个视频打开时，比例从 CSS 兜底重新学，不沿用上一个视频的值', async () => {
    const video = await ready('/video/v1')
    setVideoSize(video, 1080, 2460)
    fireEvent.loadedMetadata(video)
    expect(frame().style.getPropertyValue('--player-ratio')).toBe('1080 / 2460')

    // v2 是横版素材。renderApp 会挂一个全新的容器，所以取最后一个取景框。
    renderApp('/video/v2')
    await screen.findByText('另一个')
    const frames = document.querySelectorAll<HTMLElement>('.player__frame')
    const v2Frame = frames[frames.length - 1]

    // metadata 还没到：必须干干净净退回 CSS 兜底（9/20），不能是 v1 的 1080/2460
    expect(v2Frame.style.getPropertyValue('--player-ratio')).toBe('')

    const v2Video = document.querySelectorAll<HTMLVideoElement>('video')
    const el = v2Video[v2Video.length - 1]
    setVideoSize(el, 1920, 1080)
    fireEvent.loadedMetadata(el)
    expect(v2Frame.style.getPropertyValue('--player-ratio')).toBe('1920 / 1080')
  })
})
