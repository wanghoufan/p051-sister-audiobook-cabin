import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useCatalog } from '../components/catalog-context'
import { EmptyState, LoadingBlock, StatusMessage } from '../components/StatusMessage'
import { VideoCard } from '../components/VideoCard'
import { VideoFilters } from '../components/VideoFilters'
import { filterVideos } from '../lib/filter-videos'
import type { FilterState } from '../lib/filter-videos'
import { DURATION_BUCKETS, LEVEL_ORDER, VIDEO_TYPE_ORDER } from '../lib/types'
import type { DurationBucketId, Level, VideoType } from '../lib/types'

/**
 * 从 query 里取**单个**合法值，非法/缺失一律回退到 null（不筛）。
 * 三个维度都是单选，所以不再需要 parseList 的逗号分隔。
 */
function parseOne<T extends string>(raw: string | null, allowed: readonly T[]): T | null {
  if (!raw) return null
  const key = raw.trim() as T
  return allowed.includes(key) ? key : null
}

function parseFilters(params: URLSearchParams): FilterState {
  return {
    types: parseOne<VideoType>(params.get('types'), VIDEO_TYPE_ORDER)
      ? [params.get('types') as VideoType]
      : [],
    level: parseOne<Level>(params.get('level'), LEVEL_ORDER),
    duration: parseOne<DurationBucketId>(
      params.get('durations'),
      DURATION_BUCKETS.map((bucket) => bucket.id),
    ),
  }
}

/** 三个维度都是单选，值直接写；没选的维度不写进 URL，保持 URL 干净。 */
function serializeFilters(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.types.length > 0) params.set('types', filters.types.join(','))
  if (filters.level !== null) params.set('level', filters.level)
  if (filters.duration !== null) params.set('durations', filters.duration)
  return params
}

export function Find() {
  const { state } = useCatalog()
  const [searchParams, setSearchParams] = useSearchParams()

  // 筛选状态完全存在 URL 里：刷新、按返回键都保住选择。
  const urlFilters = useMemo(() => parseFilters(searchParams), [searchParams])
  const searchKey = searchParams.toString()

  // 乐观筛选：点胶囊必须**这一帧**就变，不等路由把 URL 写回去。
  //
  // 根因（不是 filterVideos 的问题）：setSearchParams → useNavigate → router.navigate
  // → react-router 内部 `React.startTransition(() => setStateImpl(newState))`
  // （node_modules/react-router/dist/…/chunk-*.mjs，updateState 分支）。也就是说
  // 「URL 变了」和「组件重渲染、结果更新」之间隔着一次**并发 transition 渲染**。
  // 页面在后台/最小化时，React 调度器拿不到 rAF，这段工作会被推迟几百毫秒到好几秒
  // （验收实测 0.4s / 2.4s / >4.7s 三次），表现就是「点了 K1，什么都没发生」。
  //
  // 做法：记下「点击那一刻的 searchKey」和期望的筛选值。只要 URL 还停在我点击
  // 那一刻的取值上，就说明只是 transition 还没渲染出来 —— 先用乐观值渲染。
  // URL 一变（不管是 router 追上来了，还是用户按了后退/前进）就自动交回 URL 驱动，
  // 所以不存在「乐观值卡住不消失」的状态，也不需要额外的 effect 清理。
  const [optimistic, setOptimistic] = useState<{ from: string; filters: FilterState } | null>(null)
  const filters = optimistic !== null && optimistic.from === searchKey ? optimistic.filters : urlFilters

  const apply = (next: FilterState) => {
    setOptimistic({ from: searchKey, filters: next })
    setSearchParams(serializeFilters(next), { replace: false })
  }

  const results = useMemo(
    () => filterVideos(state.status === 'ready' ? state.videos : [], filters),
    [state, filters],
  )

  // 不传 title/subtitle：顶部那两行字在真机上占约 110px（首屏 13%），
  // 而「点一下条件」这件事不需要文字解释，三个维度都是自解释的胶囊/分类栏。
  // AppShell 在两者都缺省时整个 <header> 不渲染，页面直接从内容区开始。
  return (
    <AppShell>
      {state.status === 'loading' && <LoadingBlock label="正在加载视频目录…" count={3} />}
      {state.status === 'error' && (
        <StatusMessage tone="error" title="暂时看不到视频">
          {state.message} 请确认 Mac Mini 已开机并与这台手机连在同一个 Wi-Fi。
        </StatusMessage>
      )}
      {state.status === 'empty' && (
        <StatusMessage tone="info" title="视频目录里还没有可播放的视频">
          请联系家人，让他们在 Mac Mini 上把视频放进仓库后再打开这个网页。
        </StatusMessage>
      )}

      {state.status === 'ready' && (
        <div className="find-layout">
          {/* 等级 + 时长两行胶囊，铺满整行宽度（左栏从分割线才往下开始） */}
          <VideoFilters filters={filters} onChange={apply} />
          <section className="find-main" aria-label="筛选结果">
            {/* 结果数量与排序已按产品要求删除（真机上独占一整行）。
                筛选后变化的可访问性播报挪到空态块上，见下面 EmptyState。 */}
            {results.length === 0 ? (
              <div role="status" aria-live="polite">
                <EmptyState title="没有符合条件的视频">
                  再点一次已选中的那个标签就能取消它。
                </EmptyState>
              </div>
            ) : (
              <ul className="video-grid">
                {results.map((video) => (
                  <VideoCard key={video.id} video={video} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </AppShell>
  )
}
