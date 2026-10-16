import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { formatDuration, formatMinutes } from '../lib/format'
import { isResumablePosition, readLastTraining } from '../lib/last-training'
import type { Video } from '../lib/types'

interface LastTrainingBannerProps {
  videos: Video[]
}

/**
 * 「上次训练」置顶卡片。
 * 记录缺失、videoId 不在目录里、或位置不值得续播时 —— 整个区域不渲染（SPEC US3 第 2 条）。
 */
export function LastTrainingBanner({ videos }: LastTrainingBannerProps) {
  const record = useMemo(() => readLastTraining(), [])
  if (!record) return null

  const video = videos.find((item) => item.id === record.videoId)
  if (!video || !video.available) return null
  if (!isResumablePosition(record.positionSeconds, video.durationSeconds)) return null

  const percent = Math.max(
    2,
    Math.min(100, Math.round((record.positionSeconds / video.durationSeconds) * 100)),
  )

  return (
    <section className="resume-card" aria-labelledby="resume-heading">
      <h2 id="resume-heading">上次训练</h2>
      <p className="resume-card__title">{video.title}</p>
      <p className="resume-card__meta">
        已看到第 {formatDuration(record.positionSeconds)} / 全片 {formatMinutes(video.durationSeconds)}
        （{formatDuration(video.durationSeconds)}）
      </p>
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="上次观看进度"
      >
        <div className="progress__bar" style={{ width: `${percent}%` }} />
      </div>
      <Link className="btn btn--primary" to={`/video/${video.id}?resume=1`}>
        继续播放
      </Link>
    </section>
  )
}
