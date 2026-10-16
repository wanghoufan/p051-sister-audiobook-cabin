import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 播放页取景框的 CSS 契约（必修项 1）。
 *
 * 为什么是静态断言而不是渲染后量尺寸：
 *   jsdom 不实现 CSS 布局引擎，getBoundingClientRect() 永远返回 0×0，
 *   aspect-ratio / height / max-height / object-fit 一条都算不出来。
 *   这条缺陷（写了 16/9 却把 1080×2460 竖版画面的横向利用率压到 25%）
 *   恰恰是"算出来的值和写的不一样"，所以只能在 CSS 文本层面把契约钉住。
 *   真实盒模型由 browseros-neo 在真视口下实测（见 qa-report）。
 */

const CSS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/index.css')

async function readCss(): Promise<string> {
  return readFile(CSS_PATH, 'utf8')
}

/** 取一条规则的花括号内容（跳过嵌套的 @media）。 */
function ruleBody(css: string, selector: string): string {
  const from = css.indexOf(selector)
  if (from < 0) throw new Error(`没找到规则 ${selector}`)
  const open = css.indexOf('{', from)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error(`规则 ${selector} 没有闭合`)
}

describe('播放页取景框：真实比例 + 视口高度上限', () => {
  it('.player__frame 用 var(--player-ratio) 而不是写死 16/9', async () => {
    const body = ruleBody(await readCss(), '.player__frame').replace(/\s/g, '')
    expect(body, '没找到 .player__frame').toContain('aspect-ratio:var(--player-ratio')
    // 写死的 16/9 正是这个缺陷的根因：竖版素材塞进横版容器必然两侧留黑
    expect(body, '不能写死 16/9：全库 130 个视频都是 1080×2460 竖版').not.toContain('aspect-ratio:16/9')
  })

  it('--player-ratio 有兜底值，metadata 未到达时不会塌成 0 高', async () => {
    const body = ruleBody(await readCss(), '.player__frame').replace(/\s/g, '')
    // 兜底比例：竖版素材的典型值，比 16/9 更接近真实素材
    expect(body).toMatch(/--player-ratio:\s*\d+\s*\/\s*\d+/)
    // 兜底高度：视频 readyState=0 时至少留一个可见的盒子
    expect(body, '缺 min-height：视频没加载时高度会塌成 0').toMatch(/min-height:\d+px/)
    expect(body, '必须有确定的高度来源（从高度反推宽度）').toContain('height:min(')
  })

  it('盒子高度封顶、宽度由 aspect-ratio 反推，比例恒等于内容比例', async () => {
    const body = ruleBody(await readCss(), '.player__frame').replace(/\s/g, '')
    // width:auto + aspect-ratio + 确定的 height ⇒ 浏览器按比例算宽度
    expect(body, '必须是 width:auto：从高度反推宽度，盒子比例才不会失配').toContain('width:auto')
    // 高度上限用 dvh：Android 地址栏会吃掉可视高度
    expect(body).toContain('dvh')
    // 宽度不能超过容器
    expect(body).toContain('max-width:100%')
    // 居中：桌面宽屏时两侧留白由页面背景承担
    expect(body).toContain('margin:0auto')
  })

  it('.player__video 用 object-fit: contain（比例失配时宁可留黑边也不裁画面）', async () => {
    const css = await readCss()
    const body = ruleBody(css, '.player__video').replace(/\s/g, '')
    expect(body).toContain('object-fit:contain')
    // 绝不能用 cover：cover 会把控制条/画面切掉，而控制条必须永远可见
    expect(body, '不能用 cover：它会裁切画面').not.toContain('object-fit:cover')
    // 视频铺满取景框，高度由父级 aspect-ratio 决定
    expect(body).toContain('width:100%')
    expect(body).toContain('height:100%')
    // 旧的比例声明必须已经移除，否则会与取景框的 aspect-ratio 打架
    expect(body, '.player__video 上不该再有 aspect-ratio').not.toContain('aspect-ratio')
  })

  it('桌面（≥900px）单独放宽高度上限，仍然是真实比例', async () => {
    const css = await readCss()
    const desktop = css.slice(css.indexOf('@media (min-width: 900px)'))
    const body = ruleBody(desktop, '.player__frame').replace(/\s/g, '')
    expect(body, '桌面必须显式给一个高度上限，否则 1080×2460 会在 900px 视口里溢出').toContain('height:min(')
    expect(body).toContain('dvh')
    // 桌面同样不能退回 16/9
    expect(body).not.toContain('aspect-ratio:16/9')
  })

  it('取景框的类名与 VideoPlayer.tsx 里用的一致', async () => {
    const [css, tsx] = await Promise.all([
      readCss(),
      readFile(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages/VideoPlayer.tsx'),
        'utf8',
      ),
    ])
    expect(css).toContain('.player__frame')
    expect(tsx, 'VideoPlayer 必须渲染 .player__frame 作为比例变量的落点').toContain('className="player__frame"')
    expect(tsx, '必须给取景框挂 ref，CSS 变量要写在它上面').toMatch(/ref=\{frameRef\}/)
    expect(tsx, '必须读 videoWidth/videoHeight 写进 --player-ratio').toContain('videoWidth')
    expect(tsx, '必须读 videoWidth/videoHeight 写进 --player-ratio').toContain("'--player-ratio'")
  })
})
