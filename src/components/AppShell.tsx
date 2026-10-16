import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

interface AppShellProps {
  /**
   * 顶部标题与副标题。**筛选页刻意不传**：那两行字在真机上占掉约 110px，
   * 相当于首屏的 13%，而内容（左侧分类 + 难度 + 时长）一眼就能看懂，不需要解释。
   * 不传时整个 <header> 不渲染，页面直接从内容区开始。
   */
  title?: string
  subtitle?: string
  /**
   * 标题右侧的同行内容（首页是「共 N 个」）。
   * 与标题同高同行，不额外占垂直空间 —— 真机上每多一行就是首屏的 4%。
   */
  trailing?: ReactNode
  children: ReactNode
  /** 播放页有自己的返回路径，隐藏底部导航。 */
  showNav?: boolean
}

/** 全站外壳：顶部标题（可选）+ 内容区 + 底部两个大触控入口。 */
export function AppShell({ title, subtitle, trailing, children, showNav = true }: AppShellProps) {
  return (
    <div className="app-shell">
      {(title || subtitle || trailing) && (
        <header className="app-shell__header">
          <div className="app-shell__head-line">
            {title && <h1>{title}</h1>}
            {trailing}
          </div>
          {subtitle && <p className="app-shell__subtitle">{subtitle}</p>}
        </header>
      )}
      <main className="app-shell__main">{children}</main>
      {showNav && (
        <nav className="app-nav" aria-label="主导航">
          <NavLink to="/" end>首页</NavLink>
          <NavLink to="/find">筛选</NavLink>
          {/* 第三个 tab：练习历史（产品决定 2026-09-28）。放在最后 ——
              前两个是「找视频」的必经路径，历史是回来看记录的，频次低一档。 */}
          <NavLink to="/history">历史</NavLink>
        </nav>
      )}
    </div>
  )
}
