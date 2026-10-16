import '@testing-library/jest-dom/vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makePayload,
  makeVideo,
  renderApp,
  seedLastTraining,
  stubCatalogFetch,
  stubCatalogFetchError,
} from './helpers'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Home', () => {
  it('ready 态渲染全部视频：available:false 标灰且不可点', async () => {
    const videos = [
      makeVideo({ id: 'ok-1', title: '第一节有氧' }),
      makeVideo({ id: 'bad-1', title: '丢失的文件', available: false, thumbnailUrl: null }),
    ]
    stubCatalogFetch(makePayload(videos))
    renderApp('/')

    await screen.findByText('第一节有氧')
    expect(screen.getByText('丢失的文件')).toBeInTheDocument()

    const good = screen.getByText('第一节有氧').closest('a')
    expect(good).toHaveAttribute('href', '/video/ok-1')

    const badCard = screen.getByText('丢失的文件').closest('.video-card')
    expect(badCard).toHaveClass('video-card--unavailable')
    expect(badCard?.tagName).not.toBe('A')
    expect(within(badCard as HTMLElement).getByText('暂不可播放')).toBeInTheDocument()
    expect(screen.getByText('共 2 个')).toBeInTheDocument()
  })

  it('有可续播记录 → 置顶显示并可继续播放', async () => {
    stubCatalogFetch(makePayload([makeVideo({ id: 'v1', durationSeconds: 600 })]))
    seedLastTraining('v1', 120)
    renderApp('/')

    const resume = await screen.findByRole('region', { name: '上次训练' })
    expect(resume).toBeInTheDocument()
    expect(within(resume).getByText('4 分钟 Tabata 燃脂急救')).toBeInTheDocument()
    expect(within(resume).getByRole('link', { name: '继续播放' })).toHaveAttribute(
      'href',
      '/video/v1?resume=1',
    )
  })

  it('没有记录 → 整个上次训练区不渲染', async () => {
    stubCatalogFetch(makePayload([makeVideo()]))
    renderApp('/')

    await screen.findByText('4 分钟 Tabata 燃脂急救')
    expect(screen.queryByText('上次训练')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '继续播放' })).not.toBeInTheDocument()
  })

  it('记录指向目录里不存在的 id → 不渲染', async () => {
    stubCatalogFetch(makePayload([makeVideo({ id: 'v1' })]))
    seedLastTraining('ghost', 120)
    renderApp('/')

    await waitFor(() => expect(document.querySelector('.video-grid')).toBeInTheDocument())
    expect(screen.queryByText('上次训练')).not.toBeInTheDocument()
  })

  it('位置不可续播（刚开头 2 秒）→ 不渲染', async () => {
    stubCatalogFetch(makePayload([makeVideo({ id: 'v1', durationSeconds: 600 })]))
    seedLastTraining('v1', 2)
    renderApp('/')

    await waitFor(() => expect(document.querySelector('.video-grid')).toBeInTheDocument())
    expect(screen.queryByText('上次训练')).not.toBeInTheDocument()
  })

  it('error 态显示中文提示与 Wi-Fi 排查指引', async () => {
    stubCatalogFetchError()
    renderApp('/')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Mac Mini')
    expect(alert).toHaveTextContent('Wi-Fi')
    expect(within(alert).getByRole('button', { name: '再试一次' })).toBeInTheDocument()
  })

  it('empty 态提示目录为空', async () => {
    stubCatalogFetch(makePayload([]))
    renderApp('/')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('视频目录里还没有可播放的视频')
  })

  it('加载中显示正在加载', async () => {
    stubCatalogFetch(makePayload([makeVideo()]))
    renderApp('/')
    expect(screen.getByText('正在加载视频目录…')).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('.video-grid')).toBeInTheDocument())
  })
})
