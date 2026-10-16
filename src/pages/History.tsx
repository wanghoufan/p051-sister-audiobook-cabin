import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useCatalog } from '../components/catalog-context'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'
import { canResume, historyPercent, readHistory, removeHistoryEntry } from '../lib/history'
import type { HistoryEntry } from '../lib/history'
import { formatDuration } from '../lib/format'
import { isResumablePosition, readLastTraining } from '../lib/last-training'
import { levelTone } from '../lib/format'
import { isTwoLineType, typeLabelLines } from '../lib/types'
import type { Video } from '../lib/types'

/** 「昨天 / 3 天前 / 10 月 5 日」这种相对说法，比一串日期数字好读。 */
function formatWhen(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const day = 86_400_000
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < day) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 2 * day) return '昨天'
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  return new Date(timestamp).toLocaleDateString('zh-CN')
}

export function History() {
  const { state } = useCatalog()

  // 每次进入这个页面重新读一次 localStorage：练习是在别的页面发生的，
  // 组件不会因为 localStorage 变化而重渲染，自己读是唯一可靠的做法。
  // 用 state 而不是 useMemo：点了「删除」之后必须重画列表，
  // useMemo 的依赖是空数组，删完不会重新计算。
  const [entries, setEntries] = useState<HistoryEntry[]>(() => readHistory())
  const reload = useCallback(() => setEntries(readHistory()), [])

  // 目录里还找得到的视频（用于拿标题/时长/封面）。找不到的（文件被移走了）
  // 依然显示记录本身，只是没有封面 —— 记录是用户的历史，不该因为文件没了就消失。
  const videos = useMemo(() => {
    const map = new Map<string, Video>()
    if (state.status === 'ready') {
      for (const video of state.videos) map.set(video.id, video)
    }
    return map
  }, [state])

  const lastTraining = useMemo(() => readLastTraining(), [])

  return (
    <AppShell title="历史" trailing={<p className="app-shell__count">共 {entries.length} 条</p>}>
      {state.status === 'loading' && <LoadingBlock label="正在加载视频目录…" />}
      {state.status === 'error' && (
        <StatusMessage tone="error" title="暂时看不到视频">
          {state.message} 请确认 Mac Mini 已开机并与这台手机连在同一个 Wi-Fi。
        </StatusMessage>
      )}

      {state.status !== 'loading' && entries.length === 0 && (
        <EmptyHistory />
      )}

      {entries.length > 0 && (
        <ol className="history-list">
          {entries.map((entry) => {
            const video = videos.get(entry.videoId)
            const duration = video?.durationSeconds ?? 0
            // 续播目标优先用 last-training（那是播放器真正在用的那份），
            // 没有时退回历史记录自己的位置 —— 两者不一致时以 last-training 为准。
            const resumeAt =
              lastTraining?.videoId === entry.videoId &&
              isResumablePosition(lastTraining.positionSeconds, duration)
                ? lastTraining.positionSeconds
                : null
            const resumable = canResume(entry, duration) || resumeAt !== null
            const percent = historyPercent(entry, duration)
            // 点进去的目标：有进度就带 ?resume=1 续播，否则从头开始
            const target = resumable ? `/video/${entry.videoId}?resume=1` : `/video/${entry.videoId}`

            return (
              <li className="history-item" key={entry.videoId}>
                <Link className="history-item__main" to={target}>
                  <div className="history-item__thumb">
                    {video?.thumbnailUrl ? (
                      <img
                        className="history-item__img"
                        src={video.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        width={240}
                        height={320}
                      />
                    ) : (
                      <div className="history-item__placeholder" aria-hidden="true">
                        ▶
                      </div>
                    )}
                    <span className="history-item__duration" aria-hidden="true">
                      {formatDuration(duration)}
                    </span>
                  </div>
                  <div className="history-item__body">
                    <p className="history-item__title">
                      {video?.title ?? '这个视频已经从 Mac 上移走了'}
                    </p>
                    <div className="history-item__tags">
                      {video?.types.map((type) => (
                        <span className={`tag${isTwoLineType(type) ? ' tag--two-line' : ''}`} key={type}>
                          {typeLabelLines(type).map((line) => (
                            <span key={line}>{line}</span>
                          ))}
                        </span>
                      ))}
                      {video?.level != null && (
                        <span className={`level ${levelTone(video.level)}`}>{video.level}</span>
                      )}
                    </div>
                    <div
                      className="progress"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                      aria-label={`${video?.title ?? '这个视频'}的练习进度`}
                    >
                      <div className="progress__bar" style={{ width: `${percent}%` }} />
                    </div>
                    <p className="history-item__meta">
                      {entry.completed ? (
                        <>已练完</>
                      ) : resumable ? (
                        <>看到第 {formatDuration(resumeAt ?? entry.positionSeconds)}，点一下接着练</>
                      ) : (
                        <>练过 {formatDuration(entry.positionSeconds)}</>
                      )}
                      {entry.playCount > 1 && ` · 第 ${entry.playCount} 次`}
                      {` · ${formatWhen(entry.lastPlayedAt)}`}
                    </p>
                  </div>
                </Link>
                <button
                  type="button"
                  className="history-item__remove"
                  aria-label={`从历史里删除 ${video?.title ?? '这条记录'}`}
                  onClick={() => {
                    removeHistoryEntry(entry.videoId)
                    // 删完立刻重画：localStorage 没有事件，不主动 reload 的话
                    // 列表会一直显示着刚删掉的那条。
                    reload()
                  }}
                >
                  删除
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </AppShell>
  )
}

function EmptyHistory() {
  return (
    <div className="empty-hint">
      <p>还没有练习记录。</p>
      <p>
        去<Link to="/">首页</Link>或<Link to="/find">筛选</Link>挑一个视频开始练，
        练过之后这里就会记下来 —— 练到一半退出也会记，下次可以接着练。
      </p>
    </div>
  )
}
