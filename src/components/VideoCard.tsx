import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDuration, levelTone } from '../lib/format'
import { isTwoLineType, typeLabelLines, VIDEO_TYPE_LABELS } from '../lib/types'
import type { Video } from '../lib/types'

function Thumbnail({ video }: { video: Video }) {
  // 封面可能为 null、也可能 404 / 解码失败：三种情况都降级到统一占位
  // （Constitution：封面缺失不崩）。
  //
  // onError 是**白屏兜底的最后一道闸**，必须留着。真机上 266 张封面里任何一张
  // 404 或解码失败，浏览器只会让这一张 <img> 变空白 —— 但如果同时有一批图
  // 解码失败，Chrome 的渲染进程会因此被 OOM 杀，整页白屏。onError 把每一张
  // 失败图立刻换成纯 CSS 的占位块，不再发起解码，也就不会拖累整个渲染进程。
  const [broken, setBroken] = useState(false)
  const showImage = video.thumbnailUrl !== null && !broken

  return (
    <div className="video-card__thumb">
      {showImage ? (
        <img
          className="video-card__img"
          src={video.thumbnailUrl as string}
          alt=""
          loading="lazy"
          decoding="async"
          // 固有比例必须与 .video-card__thumb 的 3:4 对齐：属性值只影响加载前预留的
          // 空间和渐进式增强的固有比例，写错不会撑破容器（绝对定位 + overflow:hidden），
          // 但会让浏览器在图片解码前按错的形状预取。
          //
          // 240×320 必须与服务端实际下发的像素尺寸一致（prepare-videos.mjs 的
          // THUMB_WIDTH/THUMB_HEIGHT）。这里写大了不会多占解码内存（解码按真实
          // 文件尺寸算），但会让浏览器在图片到位前预留一块过大的空间。
          width={240}
          height={320}
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="video-card__placeholder">
          <span className="video-card__placeholder-icon" aria-hidden="true">
            ▶
          </span>
          <span>暂无封面</span>
        </div>
      )}
      <span className="video-card__duration" aria-hidden="true">
        {formatDuration(video.durationSeconds)}
      </span>
    </div>
  )
}

interface VideoCardProps {
  video: Video
}

/**
 * 视频卡片。available === false 时渲染为不可点击的禁用条目（标灰 + 「暂不可播放」），
 * 不提供任何进入播放页的入口。
 */
export function VideoCard({ video }: VideoCardProps) {
  const body = (
    <>
      <Thumbnail video={video} />
      <div className="video-card__body">
        <p className="video-card__title">{video.title}</p>
        <div className="tag-row">
          {video.types.map((type) => (
            <span className={`tag${isTwoLineType(type) ? ' tag--two-line' : ''}`} key={type}>
              {typeLabelLines(type).map((line) => (
                <span key={line}>{line}</span>
              ))}
            </span>
          ))}
          {/* level 为 null（还没从封面识图出等级）时**整块不渲染**：
              不显示占位文字，也不猜一个 K 值。60+ 的用户会照着标签去练，
              错标比不标危险。空标签行是刻意的，不是漏了。 */}
          {video.level !== null && <span className={`level ${levelTone(video.level)}`}>{video.level}</span>}
          {!video.available && <span className="tag tag--muted">暂不可播放</span>}
        </div>
      </div>
    </>
  )

  if (!video.available) {
    return (
      <li className="video-card video-card--unavailable" aria-disabled="true" data-video-id={video.id}>
        {body}
        <span className="sr-only sr-only--inline">这个视频暂时打不开</span>
      </li>
    )
  }

  return (
    <li>
      <Link
        className="video-card"
        to={`/video/${video.id}`}
        data-video-id={video.id}
        // 整卡是链接，但它的可见文字（标题 + 类型 + 等级）被裁成 3 行、标签还会换行，
        // 读屏器照着 DOM 顺序连读会变成「4:18 4 分钟 Tabata… 有氧 全身 初级」，
        // 时长还在角标和标题里各出现一次。这里给一个语义顺序固定、不重复的朗读名。
        //
        // 等级为 null 时那一段整个不参与拼接：先 filter(Boolean) 去掉空串再 join('，')，
        // 否则会读出「有氧，，时长 4:00」这种带空档的句子。
        aria-label={[
          video.title,
          video.types.map((type) => VIDEO_TYPE_LABELS[type]).join('、'),
          video.level,
          `时长 ${formatDuration(video.durationSeconds)}`,
        ]
          .filter((part): part is string => typeof part === 'string' && part.length > 0)
          .join('，')}
      >
        {body}
      </Link>
    </li>
  )
}
