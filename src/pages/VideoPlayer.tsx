import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useCatalog } from '../components/catalog-context'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'
import { formatDuration, formatMinutes, levelTone } from '../lib/format'
import { HISTORY_MIN_SECONDS, markCompleted, recordHistory } from '../lib/history'
import {
  clearLastTraining,
  isResumablePosition,
  readLastTraining,
  writeLastTraining,
} from '../lib/last-training'
import { isTwoLineType, typeLabelLines } from '../lib/types'

/** timeupdate 在安卓上每 250ms 左右触发一次；按这个节奏写 localStorage 会拖慢播放。 */
const WRITE_INTERVAL_MS = 10_000
/** 位置至少变化这么多秒才值得写一次。 */
const WRITE_MIN_DELTA_SECONDS = 3
/**
 * 开始播放后多久往「历史」里落第一条记录。
 *
 * 为什么不是立刻：用户可能点开就退出，那不该在历史里留一条「练了 0 秒」。
 * 为什么不是等到退出时才写：那正是 M-1 缺陷的根因（退出时 currentTime 可能是 0），
 * 而且如果用户直接关掉浏览器，退出事件根本不来 —— 历史就永远缺这条。
 * 所以「开始播放 → 等 5 秒 → 落记录」，之后靠 persist 持续更新位置。
 */
const HISTORY_SEED_DELAY_MS = 5_000

export function VideoPlayer() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { state } = useCatalog()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const resumeTargetRef = useRef<number | null>(null)
  const lastWriteAtRef = useRef(0)
  const lastWritePosRef = useRef(-1)
  const hasPlayedRef = useRef(false)
  const finishedRef = useRef(false)
  const resumedRef = useRef(false)
  const sessionCountedRef = useRef(false)
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [resumedAt, setResumedAt] = useState<number | null>(null)
  const [playbackError, setPlaybackError] = useState(false)

  const video = state.status === 'ready' ? state.videos.find((item) => item.id === id) : undefined

  // 续播只在 URL 带 ?resume=1、记录指向本视频、且位置值得续播时生效。
  // 解析是幂等的（只会把同一个值填进 resumeTargetRef），因此既在 effect 里算一次，
  // 也在 loadedmetadata 时兜底再算一次：src 在 commit 阶段就挂上，metadata 事件
  // 在 preload="metadata" + 局域网极快的机器上有机会抢在 effect 之前到达。
  const resolveResumeTarget = useCallback((): number | null => {
    if (resumeTargetRef.current !== null) return resumeTargetRef.current
    if (searchParams.get('resume') !== '1' || !video) return null
    const record = readLastTraining()
    if (!record || record.videoId !== video.id) return null
    if (!isResumablePosition(record.positionSeconds, video.durationSeconds)) return null
    resumeTargetRef.current = record.positionSeconds
    return resumeTargetRef.current
  }, [searchParams, video])

  useEffect(() => {
    // 切到另一个视频（同一个组件实例复用）时先清空上一次的续播目标，
    // 否则 A 的续播位置会被套到 B 上。
    resumeTargetRef.current = null
    resumedRef.current = false
    // 同一批「本次会话」的标记也要重置，否则在 A 播放过之后切到 B，
    // B 不会累加 playCount。
    sessionCountedRef.current = false
    if (historyTimerRef.current !== null) {
      clearTimeout(historyTimerRef.current)
      historyTimerRef.current = null
    }
    resolveResumeTarget()
  }, [resolveResumeTarget])

  // 卸载时清掉待触发的历史写入定时器，避免对已卸载的 video 读 currentTime
  useEffect(
    () => () => {
      if (historyTimerRef.current !== null) clearTimeout(historyTimerRef.current)
    },
    [],
  )

  // 切视频时把比例退回 CSS 兜底值（16/9）。新视频的 loadedmetadata 会立刻覆盖它，
  // 但在那一小段窗口里留着上一个视频的比例会让新视频先被错误地拉伸一次。
  useEffect(() => {
    frameRef.current?.style.removeProperty('--player-ratio')
  }, [video?.id])

  const persist = useCallback(
    (force: boolean) => {
      // 门禁：只有「本次真的开始播放过、而且还没播完」才允许写记录。
      // 所有写入路径（timeupdate / pause / pagehide / visibilitychange）都从这里过，
      // 不会因为某条事件路径忘了判断就把别人的进度覆盖掉
      // （缺陷 M-1：只打开播放页没按播放，切后台时用 currentTime=0 覆盖了上一个视频）。
      if (!hasPlayedRef.current) return
      const element = videoRef.current
      if (!element || !video) return
      const position = element.currentTime
      // 位置 0 同样不写：isResumablePosition(0, …) 为 false，写下去换不来任何提示，
      // 只会抹掉上一个视频真实有效的进度。
      if (!Number.isFinite(position) || position <= 0) return
      const now = Date.now()
      const delta = Math.abs(position - lastWritePosRef.current)
      if (!force && (now - lastWriteAtRef.current < WRITE_INTERVAL_MS || delta < WRITE_MIN_DELTA_SECONDS)) {
        return
      }
      lastWriteAtRef.current = now
      lastWritePosRef.current = position
      writeLastTraining({ videoId: video.id, positionSeconds: position })
      // 「历史」是独立的记录，看完了也要留着（markCompleted 负责把它标完成），
      // 所以这里每次存进度都同步一次。newSession 只在「本次播放刚开始」时为 true。
      recordHistory({
        videoId: video.id,
        positionSeconds: position,
        newSession: !sessionCountedRef.current,
      })
      sessionCountedRef.current = true
    },
    [video],
  )

  // 离开页面（含切后台、关标签）时兜底存一次，避免丢进度。
  // visibilitychange 只在「切到后台」时保存：切回前台不该再写一次。
  useEffect(() => {
    const saveOnPageHide = () => persist(true)
    const saveOnHidden = () => {
      if (document.visibilityState === 'hidden') persist(true)
    }
    window.addEventListener('pagehide', saveOnPageHide)
    document.addEventListener('visibilitychange', saveOnHidden)
    return () => {
      window.removeEventListener('pagehide', saveOnPageHide)
      document.removeEventListener('visibilitychange', saveOnHidden)
    }
  }, [persist])

  const handleLoadedMetadata = () => {
    const element = videoRef.current
    // 1) 真实比例：全库 130 个视频都是 1080×2460 的竖版（约 9:20.5），
    //    容器如果写死 16:9，1080 宽的内容塞进 16:9 的盒子里横向只剩 25%。
    //    这里把 videoWidth/videoHeight 写进 --player-ratio，CSS 用它算真实盒子。
    //    与续播逻辑是两条独立的线：比例无条件同步，续播只在 ?resume=1 时才动。
    if (element) {
      const w = element.videoWidth
      const h = element.videoHeight
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        frameRef.current?.style.setProperty('--player-ratio', `${w} / ${h}`)
      }
    }
    // 2) 续播：位置恢复。ratio 已经写完了，这里提前 return 不会影响它。
    const target = resolveResumeTarget()
    if (target === null || !element || resumedRef.current) return
    resumedRef.current = true
    element.currentTime = target
    setResumedAt(target)
  }

  const handlePlay = () => {
    if (finishedRef.current) {
      // 播完之后用户又按了播放：语义上就是「从头再看一遍」。
      // 显式回到 0，避免把结尾位置当成进度写回记录。
      finishedRef.current = false
      const element = videoRef.current
      if (element && element.currentTime > 0) element.currentTime = 0
      lastWriteAtRef.current = 0
      lastWritePosRef.current = 0
    }
    // 只标记「已开始播放」；真正的第一次写入由 timeupdate 完成（FR-007：开始播放后才写）。
    hasPlayedRef.current = true

    // 「历史」的第一条记录：开始播放 5 秒后落一次。
    // 这一条是**独立**于 last-training 的路径 —— 它不依赖退出事件，
    // 所以用户直接杀掉浏览器也已经在历史里留下了「练过这条课」的痕迹。
    if (historyTimerRef.current !== null) clearTimeout(historyTimerRef.current)
    historyTimerRef.current = setTimeout(() => {
      historyTimerRef.current = null
      const element = videoRef.current
      if (!element || !video || !hasPlayedRef.current) return
      const position = element.currentTime
      if (!Number.isFinite(position) || position < HISTORY_MIN_SECONDS) return
      recordHistory({
        videoId: video.id,
        positionSeconds: position,
        newSession: !sessionCountedRef.current,
      })
      sessionCountedRef.current = true
    }, HISTORY_SEED_DELAY_MS)
  }

  const handleTimeUpdate = () => persist(false)

  const handlePause = () => persist(true)

  const handleEnded = () => {
    // 播完就当从头开始：清掉 last-training，首页不再提示续播。
    // 这里直接调 clearLastTraining，不走 persist：persist 已经被「没在播放就 return」的门禁
    // 挡掉（ended 把 hasPlayedRef 置回 false），而这里要的是「删除」而不是「写一个位置」。
    // finishedRef 记下「已经播完」，让之后补发的 pause / 再按播放都不会写回垃圾记录。
    finishedRef.current = true
    hasPlayedRef.current = false
    clearLastTraining()
    // 但「历史」里这条要**留着并标记完成** —— 用户要的就是「练过哪些」这份名单，
    // 练完了更不该从名单里消失。不走 recordHistory(position) 是因为 ended 时
    // currentTime 已被浏览器归零，写进去会让进度条显示成 0%。
    if (video) markCompleted(video.id)
    lastWriteAtRef.current = 0
    lastWritePosRef.current = -1
  }

  const playFromStart = () => {
    const element = videoRef.current
    if (!element) return
    element.currentTime = 0
    clearLastTraining()
    lastWriteAtRef.current = 0
    lastWritePosRef.current = 0
    finishedRef.current = false
    setResumedAt(null)
    resumedRef.current = true
    const attempt = element.play()
    if (attempt && typeof attempt.catch === 'function') attempt.catch(() => undefined)
  }

  return (
    <AppShell title="正在播放" subtitle="页面可以上下滑动查看视频信息。" showNav={false}>
      {state.status === 'loading' && <LoadingBlock label="正在加载视频目录…" count={1} />}
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

      {state.status === 'ready' && !video && (
        <StatusMessage
          tone="error"
          title="找不到这个视频"
          actions={
            <div className="btn-row">
              <Link className="btn btn--primary" to="/">
                返回首页
              </Link>
            </div>
          }
        >
          这个视频可能已经从 Mac 上移走了。回到首页重新选一个吧。
        </StatusMessage>
      )}

      {state.status === 'ready' && video && !video.available && (
        <StatusMessage
          tone="error"
          title="这个视频暂时打不开"
          actions={
            <div className="btn-row">
              <Link className="btn btn--primary" to="/">
                返回首页
              </Link>
            </div>
          }
        >
          Mac 上找不到对应的视频文件。回到首页选一个别的吧。
        </StatusMessage>
      )}

      {state.status === 'ready' && video && video.available && (
        <article>
          <div className="player__frame" ref={frameRef}>
            <video
              className="player__video"
              ref={videoRef}
              controls
              playsInline
              preload="metadata"
              poster={video.thumbnailUrl ?? undefined}
              src={video.playbackUrl}
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={handlePlay}
              onTimeUpdate={handleTimeUpdate}
              onPause={handlePause}
              onEnded={handleEnded}
              onError={() => setPlaybackError(true)}
            >
              你的浏览器不支持播放视频，请换用手机自带浏览器打开。
            </video>
          </div>

          {playbackError && (
            <StatusMessage
              tone="error"
              title="视频打不开"
              actions={
                <div className="btn-row">
                  <Link className="btn btn--primary" to="/">
                    返回首页
                  </Link>
                </div>
              }
            >
              这个视频可能已被移除或文件损坏。换一个视频试试，或让家人检查 Mac 上的文件。
            </StatusMessage>
          )}

          {resumedAt !== null && !playbackError && (
            <p className="player__notice" role="status">
              已从 {formatDuration(resumedAt)} 继续播放。想从头看的话，点下面的「从头播放」。
            </p>
          )}

          <div className="player__actions">
            <button type="button" className="btn btn--primary" onClick={playFromStart}>
              从头播放
            </button>
            <Link className="btn btn--quiet" to="/">
              返回首页
            </Link>
          </div>

          <h2 className="player__title">{video.title}</h2>
          <div className="player__meta">
            {video.types.map((type) => (
              <span className={`tag${isTwoLineType(type) ? ' tag--two-line' : ''}`} key={type}>
                {typeLabelLines(type).map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </span>
            ))}
            {/* level 为 null（还没识图出等级）时整块不渲染：不显示占位文字，也不猜。
                卡片上同理，两处保持一致，免得同一条视频在两个页面显示得不一样。 */}
            {video.level !== null && <span className={`level ${levelTone(video.level)}`}>{video.level}</span>}
            <span className="tag">时长 {formatDuration(video.durationSeconds)}</span>
            <span className="tag">{formatMinutes(video.durationSeconds)}</span>
          </div>

          <details className="path-details">
            <summary>文件位置（帮助家人确认是哪个文件）</summary>
            <code>{video.relativePath}</code>
          </details>
        </article>
      )}
    </AppShell>
  )
}
