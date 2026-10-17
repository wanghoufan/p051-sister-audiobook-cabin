/**
 * 全局错误边界。
 *
 * 为什么必须有：白屏是这个项目最糟的失败模式。React 一旦在渲染里抛错，
 * 整个 #root 会停在空状态，60+ 的用户只会看到一片黑/白，既不知道出事了，
 * 也不知道该找谁 —— 排查成本全落在家人身上。
 *
 * 两条纪律：
 *   1. 绝不自动 reload。没有节制的自动重试会在「一加载就崩」时变成死循环，
 *      把手机跑烫、耗光电，而用户看到的还是同一片空白。这里只提供按钮，
 *      由人点一次，就一次。
 *   2. 兜底文案要说人话：告诉他「刷新一下」和「还不行就找谁」，
 *      而不是抛一个 stack trace。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from '../audio/i18n'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 留着 console 是为了真出问题时还能在 chrome://inspect 里看到原因；
    // 用户看到的仍然是下面那句中文提示。
    console.error('[听书小屋] 页面渲染出错：', error, info.componentStack)
  }

  private readonly reload = () => {
    window.location.reload()
  }

  render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children

    return (
      <div className="status status--error" role="alert">
        <h2>{i18n.t('crashTitle')}</h2>
        <p>{i18n.t('crashText')}</p>
        <p>{i18n.t('crashHelp')}</p>
        <div className="btn-row">
          <button type="button" className="btn btn--primary" onClick={this.reload}>
            {i18n.t('reload')}
          </button>
        </div>
      </div>
    )
  }
}
