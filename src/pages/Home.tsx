import { AppShell } from '../components/AppShell'
import { LastTrainingBanner } from '../components/LastTrainingBanner'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'
import { useCatalog } from '../components/catalog-context'
import { VideoCard } from '../components/VideoCard'

const WIFI_HINT = '请确认 Mac Mini 已开机并与这台手机连在同一个 Wi-Fi。'

export function Home() {
  const { state, reload } = useCatalog()

  return (
    /* 头部合并成**一行**：标题 + 视频数量，两者同高（产品决定 2026-09-28）。
       副标题「点一下视频就能开始，不需要登录」与「全部视频」小标题都删了 ——
       真机上这两行 + 那个小标题合计约 110px（首屏 13%），
       而内容（卡片本身）才是这个页面唯一要让人看到的东西。 */
    <AppShell
      title="家庭运动视频库"
      trailing={
        state.status === 'ready' ? (
          <p className="app-shell__count">共 {state.videos.length} 个</p>
        ) : null
      }
    >
      {state.status === 'loading' && <LoadingBlock label="正在加载视频目录…" />}

      {state.status === 'error' && (
        <StatusMessage
          tone="error"
          title="暂时看不到视频"
          actions={
            <div className="btn-row">
              <button type="button" className="btn btn--primary" onClick={reload}>
                再试一次
              </button>
            </div>
          }
        >
          {state.message} {WIFI_HINT}
        </StatusMessage>
      )}

      {state.status === 'empty' && (
        <StatusMessage tone="info" title="视频目录里还没有可播放的视频">
          请联系家人，让他们在 Mac Mini 上把视频放进仓库后再打开这个网页。
        </StatusMessage>
      )}

      {state.status === 'ready' && (
        <>
          {/* 「上次训练 / 继续播放」置顶卡：这是爸爸最常用的入口（上次看到哪了，一键接着看），
              不能因为「头部要紧凑」就删掉。有记录才渲染，没有记录时整个区域不出现。 */}
          <LastTrainingBanner videos={state.videos} />
          <ul className="video-grid">
            {state.videos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </ul>
          <p className="catalog-updated">目录更新于 {new Date(state.generatedAt).toLocaleString('zh-CN')}</p>
        </>
      )}
    </AppShell>
  )
}
