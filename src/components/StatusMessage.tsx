import type { ReactNode } from 'react'

interface StatusMessageProps {
  tone: 'info' | 'error'
  title: string
  children: ReactNode
  actions?: ReactNode
}

/** 页面级提示（加载失败、目录为空等）。用 role="alert" 让读屏器也能听到。 */
export function StatusMessage({ tone, title, children, actions }: StatusMessageProps) {
  return (
    <div className={`status status--${tone}`} role="alert">
      <h2>{title}</h2>
      <p>{children}</p>
      {actions}
    </div>
  )
}

interface EmptyStateProps {
  title: string
  children: ReactNode
  actions?: ReactNode
}

/** 结果为空时的明确说明（不是白屏）。 */
export function EmptyState({ title, children, actions }: EmptyStateProps) {
  return (
    <div className="empty-hint" role="status">
      <h2>{title}</h2>
      <p>{children}</p>
      {actions}
    </div>
  )
}

interface LoadingBlockProps {
  label: string
  count?: number
}

/** 加载中骨架：给老人一个「正在加载」而不是空白。 */
export function LoadingBlock({ label, count = 6 }: LoadingBlockProps) {
  return (
    <div role="status" aria-live="polite">
      <p>{label}</p>
      <div className="skeleton-grid" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <div className="skeleton" key={i} />
        ))}
      </div>
    </div>
  )
}
