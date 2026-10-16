/**
 * ErrorBoundary 回归测试。
 *
 * 钉住的是「失败必须可见」这条产品底线：
 * React 渲染抛错时，用户看到的是一句中文提示 + 一个刷新按钮，
 * 而不是一片空白；同时绝不允许出现自动 reload 死循环。
 *
 * 为什么单独测这条：崩溃路径在正常开发里几乎跑不到，
 * 真到了 60+ 老人手上才发现是白屏，排查成本全落在家人身上。
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from '../../src/components/ErrorBoundary'

/** 一定会在渲染里抛错的组件（render 阶段抛出，会被 ErrorBoundary 接住）。 */
function Boom(): never {
  throw new Error('故意炸给测试看')
}

function OK({ label }: { label: string }) {
  return <p>{label}</p>
}

describe('ErrorBoundary：崩溃时必须显示中文提示，绝不留白屏', () => {
  // React 19 会把渲染期异常打到 console.error，测试里噪音太大，先静音。
  let consoleError: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    consoleError.mockRestore()
  })

  it('子组件抛错后显示「页面出错了」并给出行动指引', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent('页面出错了')
    // 不能只说「出错了」，得告诉人怎么办
    expect(alert).toHaveTextContent('重新加载')
    expect(alert).toHaveTextContent('告诉家里人')
  })

  it('崩溃信息提示对读屏器可见（role=alert），并且仍保留 console 里的真实原因', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    const logged = consoleError.mock.calls.flat().join(' ')
    expect(logged).toContain('页面渲染出错')
    expect(logged).toContain('故意炸给测试看')
  })

  it('不崩溃时正常渲染子组件，不显示任何兜底 UI', () => {
    render(
      <ErrorBoundary>
        <OK label="一切正常" />
      </ErrorBoundary>,
    )
    expect(screen.getByText('一切正常')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('ErrorBoundary：刷新只能由人点，绝不自动重试', () => {
  const reload = vi.fn()
  let originalLocation: Location

  beforeEach(() => {
    originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
    reload.mockClear()
  })

  it('崩溃的那一刻不会自己刷新（否则「一加载就崩」会变成死循环）', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(reload).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('点「重新加载」才刷新，且点一次只刷一次', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(reload).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
  })

  it('崩溃后的按钮仍有足够触控面积（复用 .btn，min-height/min-width 由 CSS 契约保证）', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    const button = screen.getByRole('button', { name: '重新加载' })
    expect(button.className).toContain('btn')
    expect(button.className).toContain('btn--primary')
    expect(button).toHaveAttribute('type', 'button')
    consoleError.mockRestore()
  })
})
