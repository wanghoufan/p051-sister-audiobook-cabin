import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LegacyVideoApp as App } from '../../src/LegacyVideoApp'
import { CatalogProvider } from '../../src/components/CatalogProvider'
import type { CatalogResponse, Video } from '../../src/lib/types'
import { LAST_TRAINING_KEY } from '../../src/lib/last-training'
import { HISTORY_KEY } from '../../src/lib/history'

export function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'v1',
    relativePath: 'Keep/01 4 分钟 Tabata.mp4',
    title: '4 分钟 Tabata 燃脂急救',
    durationSeconds: 240,
    types: ['cardio'],
    // 默认给一个已识别的等级；测「没识别出来」的行为时显式传 level: null。
    level: 'K2',
    hasThumbnail: true,
    thumbnailUrl: '/api/thumb/v1.jpg',
    playbackUrl: '/api/stream/v1',
    available: true,
    ...overrides,
  }
}

export function makePayload(videos: Video[]): CatalogResponse {
  return { videos, diagnostics: [], generatedAt: '2026-01-01T00:00:00.000Z' }
}

export function stubCatalogFetch(payload: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => payload,
    })),
  )
}

export function stubCatalogFetchError(): void {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed to fetch') }))
}

export function renderWithProviders(ui: ReactElement, route = '/'): void {
  render(
    <MemoryRouter initialEntries={[route]}>
      <CatalogProvider>{ui}</CatalogProvider>
    </MemoryRouter>,
  )
}

/** 通过真实的 <App /> 渲染，这样 useParams / useSearchParams 走的是真路由上下文。 */
export function renderApp(route = '/'): void {
  render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  )
}

export function seedLastTraining(videoId: string, positionSeconds: number): void {
  window.localStorage.setItem(
    LAST_TRAINING_KEY,
    JSON.stringify({ version: 1, videoId, positionSeconds, updatedAt: Date.now() }),
  )
}

/** 往「历史」里塞一条记录（测历史页时用，省得真去播一遍视频）。 */
export function seedHistory(
  entries: {
    videoId: string
    positionSeconds?: number
    playCount?: number
    completed?: boolean
    lastPlayedAt?: number
  }[],
): void {
  const now = Date.now()
  window.localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify(
      entries.map((entry) => ({
        version: 1,
        videoId: entry.videoId,
        positionSeconds: entry.positionSeconds ?? 0,
        playCount: entry.playCount ?? 1,
        completed: entry.completed ?? false,
        firstPlayedAt: entry.lastPlayedAt ?? now,
        lastPlayedAt: entry.lastPlayedAt ?? now,
      })),
    ),
  )
}

export function readStoredLastTraining(): { videoId: string; positionSeconds: number } | null {
  const raw = window.localStorage.getItem(LAST_TRAINING_KEY)
  if (!raw) return null
  const rec = JSON.parse(raw) as { videoId?: unknown; positionSeconds?: unknown }
  if (typeof rec.videoId !== 'string' || typeof rec.positionSeconds !== 'number') return null
  return { videoId: rec.videoId, positionSeconds: rec.positionSeconds }
}
