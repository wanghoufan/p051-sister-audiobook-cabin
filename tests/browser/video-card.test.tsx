import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VideoCard } from '../../src/components/VideoCard'
import { makeVideo } from './helpers'

function renderCard(vid = makeVideo()) {
  return render(
    <MemoryRouter>
      <ul>
        <VideoCard video={vid} />
      </ul>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('VideoCard', () => {
  it('有封面时渲染 lazy 图片与时长', () => {
    renderCard()
    const img = document.querySelector('img')
    expect(img).toHaveAttribute('src', '/api/thumb/v1.jpg')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('decoding', 'async')
    // 3:4 竖版封面（.video-card__thumb 的 aspect-ratio），与 CSS 契约对齐。
    // 240×320 必须与服务端实际下发的像素一致（prepare-videos 的 THUMB_WIDTH/HEIGHT），
    // 写大了会让浏览器在图片到位前预留一块过大的空间。
    expect(img).toHaveAttribute('width', '240')
    expect(img).toHaveAttribute('height', '320')
    expect(screen.getByText('4:00')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/video/v1')
  })

  it('整卡是链接，无障碍名简洁且时长只念一次（D-9）', () => {
    renderCard()
    const link = screen.getByRole('link')
    expect(link).toHaveAccessibleName('4 分钟 Tabata 燃脂急救，有氧，K2，时长 4:00')
    // 视觉角标对读屏器隐藏，避免和 aria-label 里的时长重复
    expect(screen.getByText('4:00')).toHaveAttribute('aria-hidden', 'true')
  })

  it('无封面 → 统一占位，不崩', () => {
    renderCard(makeVideo({ thumbnailUrl: null, hasThumbnail: false }))
    expect(screen.getByText('暂无封面')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('封面 404 → onError 降级为占位', () => {
    renderCard()
    const img = document.querySelector('img') as HTMLImageElement
    fireEvent.error(img)
    expect(screen.getByText('暂无封面')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('available:false → 标灰、无链接、标注暂不可播放', () => {
    renderCard(makeVideo({ available: false, id: 'bad' }))
    const card = screen.getByText('4 分钟 Tabata 燃脂急救').closest('.video-card')
    expect(card).toHaveClass('video-card--unavailable')
    expect(card).toHaveAttribute('aria-disabled', 'true')
    expect(card?.tagName).not.toBe('A')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(within(card as HTMLElement).getByText('暂不可播放')).toBeInTheDocument()
  })

  it('等级徽标按 K1–K5 分三组着色', () => {
    renderCard(makeVideo({ level: 'K4' }))
    expect(screen.getByText('K4')).toHaveClass('level--hard')
  })

  // 核心产品决定：level 为 null（还没从封面识图出等级）时**整块不渲染**。
  // 错标比不标危险 —— 60+ 的用户会照着标签去练。
  it('level 为 null → 不渲染任何等级徽标，也没有任何占位文字', () => {
    renderCard(makeVideo({ level: null }))
    expect(document.querySelector('.level')).toBeNull()
    expect(screen.queryByText(/待标注/)).not.toBeInTheDocument()
    expect(screen.queryByText(/未标注/)).not.toBeInTheDocument()
    // 徽标消失后，类型标签和时长角标照常在
    expect(screen.getByText('有氧')).toBeInTheDocument()
    expect(screen.getByText('4:00')).toBeInTheDocument()
  })

  it('level 为 null → 无障碍名里不留空档（不会出现「有氧，，时长 4:00」）', () => {
    renderCard(makeVideo({ level: null }))
    const name = screen.getByRole('link').getAttribute('aria-label') ?? ''
    expect(name).toBe('4 分钟 Tabata 燃脂急救，有氧，时长 4:00')
    expect(name).not.toContain('，，')
  })

  it('level 为 null 也不影响不可播放卡片的标灰与提示', () => {
    renderCard(makeVideo({ level: null, available: false, id: 'bad' }))
    const card = screen.getByText('4 分钟 Tabata 燃脂急救').closest('.video-card')
    expect(card).toHaveClass('video-card--unavailable')
    expect(within(card as HTMLElement).getByText('暂不可播放')).toBeInTheDocument()
    expect(document.querySelector('.level')).toBeNull()
  })
})
