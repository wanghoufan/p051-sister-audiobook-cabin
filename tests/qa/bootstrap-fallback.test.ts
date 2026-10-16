/**
 * 启动兜底（index.html 内联看门狗）的静态契约测试。
 *
 * 这个兜底的价值只在一个条件下成立：打包的 JS 根本没跑起来。
 * 所以它必须内联在 HTML 里、零依赖、且不依赖任何外部资源 ——
 * 一旦挪进 bundle，它要救的那种故障它自己也活不下来。
 *
 * 这里只做文本级断言：内联脚本无法在 node 项目里执行（vitest 的 node
 * 项目没有 document），而真正要防的是「有人顺手加个自动 reload」这种
 * 结构性改动，文本契约比运行时渲染更适合钉住它。
 */

import { describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const readIndexHtml = () => fsp.readFile(path.join(ROOT, 'index.html'), 'utf8')

/** 取出内联看门狗脚本的正文。 */
async function watchdogSource(): Promise<string> {
  const html = await readIndexHtml()
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  expect(scripts.length, 'index.html 里应当正好有一段内联脚本').toBe(1)
  return scripts[0]
}

describe('启动兜底：JS 没跑起来时也必须给出中文提示', () => {
  it('看门狗内联在 HTML 里，自己不请求任何外部资源', async () => {
    const html = await readIndexHtml()
    // 兜底必须自带全部逻辑：一旦它去引外部脚本/CSS，就等于「和主 bundle 一起消失」，
    // 恰好在最需要它的那种故障里失效。
    const inline = (await watchdogSource()).trim()
    expect(inline.length).toBeGreaterThan(0)
    for (const re of [/\bsrc\s*=/, /\bimport\s*\(/, /\bfetch\s*\(/, /navigator\.sendBeacon/]) {
      expect(re.test(inline), `兜底脚本里出现了外部依赖：${re}`).toBe(false)
    }
    // 它确实是内联的：整份 HTML 里有且只有这一段无 src 的 script
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)]
    expect(inlineScripts).toHaveLength(1)
  })

  it('React 挂载成功后看门狗完全不干预（先检查 #root 有没有内容）', async () => {
    const src = await watchdogSource()
    expect(src).toContain('root.firstChild')
    // 提前 return 必须发生在任何写 DOM 的动作之前
    const guard = src.indexOf('if (root.firstChild) return')
    const firstAppend = src.indexOf('root.appendChild')
    expect(guard).toBeGreaterThan(-1)
    expect(firstAppend).toBeGreaterThan(guard)
  })

  it('有超时阈值，兜底是「到点才画」而不是一直轮询', async () => {
    const src = await watchdogSource()
    expect(src).toMatch(/TIMEOUT\s*=\s*\d+/)
    expect(src).toContain('window.setTimeout(show, TIMEOUT)')
    // 一旦出现轮询就会在弱设备上白烧电
    expect(src).not.toContain('setInterval')
    expect(src).not.toContain('requestAnimationFrame')
  })

  it('文案说人话：提到 Wi-Fi、重新加载、以及找谁帮忙', async () => {
    const src = await watchdogSource()
    expect(src).toContain('Wi-Fi')
    expect(src).toContain('重新加载')
    expect(src).toContain('家里人')
    // 不能把 stack trace 甩给老人看
    expect(src).not.toMatch(/Error\(|\.stack/)
  })

  it('绝不自动刷新：location.reload 只能出现在点击处理里', async () => {
    const src = await watchdogSource()
    const occurrences = [...src.matchAll(/location\.reload\(\)/g)]
    expect(occurrences).toHaveLength(1)

    // 唯一那一次必须待在 addEventListener('click') 回调内部：
    // 出现在它之前的都属于「到点就自己刷」，那正是重试风暴。
    const clickAt = src.indexOf("addEventListener('click'")
    const reloadAt = src.indexOf('location.reload()')
    expect(clickAt).toBeGreaterThan(-1)
    expect(reloadAt).toBeGreaterThan(clickAt)
  })

  it('提示对读屏器可见（role=alert），且用的是现成的 .status/.btn 样式类', async () => {
    const src = await watchdogSource()
    expect(src).toContain("setAttribute('role', 'alert')")
    expect(src).toContain("'status status--error'")
    expect(src).toContain("'btn btn--primary'")
  })
})

describe('启动兜底：main.tsx 真的挂上了 ErrorBoundary', () => {
  it('createRoot 渲染的树里包含 ErrorBoundary', async () => {
    const main = await fsp.readFile(path.join(ROOT, 'src/main.tsx'), 'utf8')
    expect(main).toContain("from './components/ErrorBoundary'")
    expect(main).toContain('<ErrorBoundary>')
    // ErrorBoundary 必须在 BrowserRouter 外层：路由之外的崩溃也要被接住
    expect(main.indexOf('<ErrorBoundary>')).toBeLessThan(main.indexOf('<BrowserRouter>'))
  })

  it('main.tsx 里没有任何自动 reload（重试风暴同样致命）', async () => {
    const main = await fsp.readFile(path.join(ROOT, 'src/main.tsx'), 'utf8')
    expect(main).not.toContain('location.reload')
    expect(main).not.toContain('setInterval')
  })
})
