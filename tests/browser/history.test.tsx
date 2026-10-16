import '@testing-library/jest-dom/vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HISTORY_KEY } from '../../src/lib/history'
import { makePayload, makeVideo, renderApp, seedHistory, seedLastTraining, stubCatalogFetch } from './helpers'

/**
 * 「历史」tab 的验收。
 *
 * 夹具造出三种状态，覆盖用户真正会遇到的三个场景：
 *   - 练到一半退出 → 历史里有记录，且**点进去能接着练**（URL 带 ?resume=1）
 *   - 完整练完     → 历史里**保留**这条，但点进去是「从头看」而不是续播
 *   - 多次练同一条 → playCount 累加，列表里显示「第 N 次」
 */
const VIDEOS = [
  makeVideo({ id: 'a', title: '练到一半的课', durationSeconds: 600, types: ['stretch'], level: 'K1' }),
  makeVideo({ id: 'b', title: '练完的课', durationSeconds: 300, types: ['core'], level: 'K3' }),
  makeVideo({ id: 'c', title: '练过三次的课', durationSeconds: 900, types: ['cardio'], level: 'K2' }),
]

beforeEach(() => {
  window.localStorage.clear()
  stubCatalogFetch(makePayload(VIDEOS))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function ready() {
  renderApp('/history')
  await screen.findByRole('heading', { name: '历史' })
}

describe('History · 底部导航有第三个 tab', () => {
  it('导航是「首页 / 筛选 / 历史」三个，且当前页高亮', async () => {
    await ready()
    const nav = screen.getByRole('navigation', { name: '主导航' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(['首页', '筛选', '历史'])
    expect(links[2]).toHaveAttribute('aria-current', 'page')
  })

  it('首页与筛选页的导航也都有「历史」这一项', async () => {
    renderApp('/')
    const nav = screen.getByRole('navigation', { name: '主导航' })
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['首页', '筛选', '历史'])
  })
})

describe('History · 空状态', () => {
  it('没练过时说明怎么用，并给出通往首页/筛选的入口', async () => {
    await ready()
    const hint = screen.getByText('还没有练习记录。').closest('.empty-hint') as HTMLElement
    expect(hint).toBeInTheDocument()
    // 限定在空状态块里找链接 —— 底部导航也有「首页」「筛选」，不限定会拿到两个
    expect(within(hint).getByRole('link', { name: '首页' })).toHaveAttribute('href', '/')
    expect(within(hint).getByRole('link', { name: '筛选' })).toHaveAttribute('href', '/find')
  })
})

describe('History · 记录列表', () => {
  beforeEach(() => {
    seedHistory([
      { videoId: 'a', positionSeconds: 150, lastPlayedAt: 3_000 },
      { videoId: 'b', positionSeconds: 0, completed: true, lastPlayedAt: 2_000 },
      { videoId: 'c', positionSeconds: 400, playCount: 3, lastPlayedAt: 1_000 },
    ])
  })

  it('三条记录都显示，标题取自目录', async () => {
    await ready()
    expect(screen.getByText('练到一半的课')).toBeInTheDocument()
    expect(screen.getByText('练完的课')).toBeInTheDocument()
    expect(screen.getByText('练过三次的课')).toBeInTheDocument()
    expect(screen.getByText('共 3 条')).toBeInTheDocument()
  })

  // 产品核心需求：想继续上次的练习，直接从历史点进去。
  it('练到一半的记录：点进去带 ?resume=1，能接着练', async () => {
    await ready()
    const link = screen.getByRole('link', { name: /练到一半的课/ })
    expect(link).toHaveAttribute('href', '/video/a?resume=1')
    expect(screen.getByText(/看到第 2:30，点一下接着练/)).toBeInTheDocument()
  })

  it('已练完的记录：保留在列表里，但点进去是「从头看」不带 resume', async () => {
    await ready()
    const link = screen.getByRole('link', { name: /练完的课/ })
    expect(link).toHaveAttribute('href', '/video/b')
    expect(screen.getByText(/^已练完/)).toBeInTheDocument()
  })

  it('练过多次的记录显示次数', async () => {
    await ready()
    expect(screen.getByText(/第 3 次/)).toBeInTheDocument()
  })

  it('进度条把练习进度暴露给读屏器', async () => {
    await ready()
    const bar = screen.getByRole('progressbar', { name: /练到一半的课/ })
    expect(bar).toHaveAttribute('aria-valuenow', '25') // 150 / 600
    const done = screen.getByRole('progressbar', { name: /练完的课/ })
    expect(done).toHaveAttribute('aria-valuenow', '100')
  })

  it('点「删除」只删那一条，其余不动', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /从历史里删除 练到一半的课/ }))
    await waitFor(() => expect(screen.queryByText('练到一半的课')).not.toBeInTheDocument())
    expect(screen.getByText('练完的课')).toBeInTheDocument()
    const stored = JSON.parse(window.localStorage.getItem(HISTORY_KEY) as string) as { videoId: string }[]
    expect(stored.map((e) => e.videoId)).not.toContain('a')
  })
})

describe('History · 与目录不一致时的兜底', () => {
  it('视频已从 Mac 上移走：记录仍显示，只是没有封面并说明原因', async () => {
    seedHistory([{ videoId: 'gone', positionSeconds: 100, lastPlayedAt: 1_000 }])
    await ready()
    expect(screen.getByText('这个视频已经从 Mac 上移走了')).toBeInTheDocument()
    expect(screen.getByText(/练过 1:40/)).toBeInTheDocument()
  })

  it('时长未知（目录里没有）时不显示续播，避免给出坏进度', async () => {
    seedHistory([{ videoId: 'gone', positionSeconds: 100 }])
    await ready()
    expect(screen.getByRole('link', { name: /已经从 Mac 上移走/ })).toHaveAttribute(
      'href',
      '/video/gone',
    )
  })
})

describe('History · 与 last-training 的关系', () => {
  // 两份记录各写各的 key：last-training 给首页续播用，history 给这个页用。
  // 冲突时以 last-training 为准 —— 那是播放器真正在用的位置。
  it('last-training 位置与历史不一致时，续播目标用 last-training 的', async () => {
    seedHistory([{ videoId: 'a', positionSeconds: 150 }])
    seedLastTraining('a', 300)
    await ready()
    expect(screen.getByRole('link', { name: /练到一半的课/ })).toHaveAttribute(
      'href',
      '/video/a?resume=1',
    )
    expect(screen.getByText(/看到第 5:00，点一下接着练/)).toBeInTheDocument()
  })

  it('清历史不影响 last-training（首页的「继续播放」不该因此消失）', async () => {
    seedHistory([{ videoId: 'a', positionSeconds: 150 }])
    seedLastTraining('a', 150)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /从历史里删除/ }))
    await waitFor(() => expect(screen.getByText('还没有练习记录。')).toBeInTheDocument())
    expect(window.localStorage.getItem('keep-family-fitness:last-training:v1')).not.toBeNull()
  })
})
