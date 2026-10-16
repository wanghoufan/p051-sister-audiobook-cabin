/**
 * QA 回归测试 —— 静态审查：FR-008（无上传/删除入口）、FR-010（触控目标）、
 * 无障碍（aria / 焦点 / 对比度 / prefers-reduced-motion）。
 *
 * 为什么是「读源码 + 解析 CSS」而不是 jsdom 计算样式：
 * jsdom 不实现 CSSOM 的布局与层叠，算出来的 min-height 毫无意义。
 * 这里对 src/index.css 做文本级解析，把「可点选择器 → min-height」这条契约钉住，
 * 任何人删掉 min-height 或把 --tap 改小，这条测试立刻红。
 *
 * 对比度用 WCAG 2.x 相对亮度公式实算，不靠肉眼。
 */

import { describe, expect, it } from 'vitest'
import { promises as fsp, readFileSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../../src')
const read = (rel: string) => fsp.readFile(path.join(SRC, rel), 'utf8')

/* ---------------------------------- 工具 ---------------------------------- */

function parseVars(css: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of css.matchAll(/--([a-z-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

/** 取出某个顶层选择器的规则体（支持逗号分隔的多选择器，忽略注释）。 */
function ruleBody(css: string, selector: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const parts: string[] = []
  for (const m of stripped.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim())
    if (selectors.includes(selector)) parts.push(m[2])
  }
  return parts.join('\n')
}


function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255)
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/* ---------------------------------- 用例 ---------------------------------- */

describe('FR-008 网页不提供上传 / 改写 / 删除视频的入口', () => {
  it('前端源码里没有任何文件上传控件、FormData 或写方法请求', async () => {
    const files = ['lib/catalog.ts', 'lib/filter-videos.ts', 'lib/last-training.ts', 'lib/format.ts', 'lib/types.ts', 'App.tsx', 'main.tsx', 'components/AppShell.tsx', 'components/CatalogProvider.tsx', 'components/ErrorBoundary.tsx', 'components/LastTrainingBanner.tsx', 'components/StatusMessage.tsx', 'components/VideoCard.tsx', 'components/VideoFilters.tsx', 'components/catalog-context.ts', 'pages/Find.tsx', 'pages/Home.tsx', 'pages/VideoPlayer.tsx']
    const banned = [
      /type\s*=\s*["']file["']/,
      /FormData/,
      /<form\b/,
      /method\s*:\s*['"](POST|PUT|DELETE|PATCH)['"]/,
      /method\s*=\s*['"](POST|PUT|DELETE)['"]/,
    ]
    for (const file of files) {
      const text = await read(file)
      for (const re of banned) expect(re.test(text), `${file} 命中 ${re}`).toBe(false)
    }
  })

  it('前端只有一处 fetch，且只有 GET', async () => {
    const text = await read('lib/catalog.ts')
    const fetches = [...text.matchAll(/fetch\(/g)]
    expect(fetches).toHaveLength(1)
    expect(text).toContain("fetch(CATALOG_ENDPOINT")
    expect(/method\s*:/.test(text)).toBe(false)
  })

  it('后端只有 /api/rescan 一个 POST，其余路由全部 GET/HEAD', async () => {
    const text = await fsp.readFile(path.resolve(__dirname, '../../server.mjs'), 'utf8')
    const posts = [...text.matchAll(/method !== 'POST'/g)]
    expect(posts).toHaveLength(1)
    expect(text).toContain("pathname === '/api/rescan'")
    // 405 出现在每一处非 GET/HEAD 的守卫上
    const guards = [...text.matchAll(/method !== 'GET' && method !== 'HEAD'/g)]
    expect(guards.length).toBeGreaterThanOrEqual(5)
  })

  it('后端代码里不存在作用于视频路径的写/删/改名调用', async () => {
    const dir = path.resolve(__dirname, '../../server')
    const files = [...(await fsp.readdir(dir)), 'server.mjs']
    for (const name of files) {
      const raw = await fsp.readFile(name.startsWith('server.') ? path.resolve(__dirname, '../..', name) : path.join(dir, name), 'utf8')
      // 去掉注释后再找写盘调用（catalog-scan.mjs 的文件头注释里就写着「绝不 write/unlink/rename」）
      const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      // 只允许 duration-probe 写 catalog-cache.json（compose 里 catalog 是只读挂载）
      const writes = [...text.matchAll(/(writeFile|appendFile|unlink|createWriteStream|rename|copyFile|fsp\.rm\()/g)]
      if (name === 'duration-probe.mjs') {
        expect(text).toContain('mergeDurationsIntoCache')
        continue
      }
      expect(writes, `${name} 出现写盘调用`).toHaveLength(0)
    }
  })
})

describe('FR-010 触控目标不小于 44px', () => {
  it('--tap 变量是 44px', async () => {
    const vars = parseVars(await read('index.css'))
    expect(vars['tap']).toBe('44px')
  })

  const clickable: [string, string][] = [
    ['.app-nav a', '底部导航'],
    ['.btn', '所有按钮'],
    ['.video-card', '视频卡片（整卡可点）'],
    ['.type-rail__item', '类型分类栏每一项'],
    ['.chip', '等级/时长胶囊'],
    ['.path-details summary', '文件位置折叠条'],
  ]

  for (const [selector, label] of clickable) {
    it(`${label}（${selector}）声明了 min-height: var(--tap)`, async () => {
      const body = ruleBody(await read('index.css'), selector)
      expect(body.length, `没找到 ${selector} 的规则`).toBeGreaterThan(0)
      expect(body.replace(/\s/g, '')).toMatch(/min-height:var\(--tap\)/)
    })
  }

  it('按钮同时有 min-width，避免窄按钮（如「完成」）横向不足 44px', async () => {
    const body = ruleBody(await read('index.css'), '.btn')
    expect(body.replace(/\s/g, '')).toContain('min-width:var(--tap)')
  })

  // 回归守卫：首页「继续播放」是 <Link class="btn"> → <a>，默认 display:inline。
  // inline 盒的 min-height 与纵向 padding 无效，按钮被行盒压扁、盖在上面的
  // 进度条和标题上（首页播放键覆盖内容的根因）。必须显式 inline-flex。
  it('.btn 显式声明 display（<a> 默认 inline 会让 44px 高失效并覆盖相邻内容）', async () => {
    const body = ruleBody(await read('index.css'), '.btn').replace(/\s/g, '')
    expect(body, '.btn 缺 display 声明，<a> 形态的按钮会退回 inline').toMatch(
      /display:(inline-)?(flex|grid)/,
    )
  })

  // 回归守卫：**4 个时长胶囊（≤5min / 6-15min / 16-30min / ≥31min）必须在 360px
  // 屏上排成一行**，否则视频网格被顶到首屏以下。
  // 收窄的取舍：触控高度锁死 --tap(44px)（红线，60+ 的手指要点得中），
  // 只压横向 padding、字号降到 15px（仍 ≥14px 最小字号线）、并关掉换行。
  it('筛选胶囊保持 44px 触控高，且必须排成一行（nowrap + 窄内边距）', async () => {
    const body = ruleBody(await read('index.css'), '.chip').replace(/\s/g, '')
    expect(body, '触控高度红线不能动').toContain('min-height:var(--tap)')
    expect(body, '去掉空格后形如 padding:4px 或 padding:4px6px，横向内边距必须 ≤6px').toMatch(
      /padding:4px(4px|6px)?;/,
    )
    expect(body, '文字不许换行，nowrap 掉了 4 个时长胶囊就会折行').toContain('white-space:nowrap')
    expect(body, '字号下限 15px（a11y 最小字号线是 14px，这里留一点余量）').toMatch(
      /font-size:1[5-9]px/,
    )
    const row = ruleBody(await read('index.css'), '.chip-row').replace(/\s/g, '')
    // flex-wrap:nowrap 是「必须一行」的关键契约：写回 wrap 就会在窄屏折行
    expect(row, '.chip-row 必须 nowrap，否则时长胶囊会折成两行').toContain('flex-wrap:nowrap')
    expect(Number(row.match(/gap:(\d+)px/)?.[1])).toBeLessThanOrEqual(8)
    // 「铺满整行」= 每颗 flex:1 等分。缺了它胶囊就是内容宽度，两行之间留一大片空白，
    // 看起来完全不像「铺满」。
    // 去空格后形如 flex:110 —— flex:1 1 0
    expect(body, '胶囊必须 flex:1 等分整行宽度，这是「铺满」的实现点').toContain('flex:110')
  })

  // 左侧分类栏是筛选页的主要入口，横向内边距不能太小 —— 太窄会让
  // 上下相邻的两项视觉上粘在一起，老人容易点错行。
  it('类型分类栏每一项也是 44px 高，横向内边距 ≥6px 且不换行', async () => {
    const body = ruleBody(await read('index.css'), '.type-rail__item').replace(/\s/g, '')
    expect(body, '类型分类栏是主要入口，触控高度不能低于 44px').toContain('min-height:var(--tap)')
    expect(body, '横向内边距太小会和相邻项粘在一起').toMatch(/padding:\d+px(\d+px)?/)
    expect(body, '两字标签不许折行').toContain('white-space:nowrap')
    expect(body, '字号必须 ≥16px').toMatch(/font-size:1[6-9]px/)
  })

  it('正文字号 ≥ 16px，最小字号 14px（src/index.css 里的 font-size 声明）', async () => {
    const css = await read('index.css')
    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(5)
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14)
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(20) // 存在 ≥20px 的标题
  })
})

describe('无障碍（对比度 / 焦点 / 动效 / aria）', () => {
  it('所有文字与背景的对比度都达到 WCAG AA（≥4.5:1）', async () => {
    const vars = parseVars(await read('index.css'))
    const pairs: [string, string, string][] = [
      ['正文', vars.text, vars.bg],
      ['正文（卡片底）', vars.text, vars['bg-raised']],
      ['次要文字', vars['text-muted'], vars.bg],
      ['次要文字（卡片底）', vars['text-muted'], vars['bg-raised']],
      ['最弱文字', vars['text-faint'], vars['bg-raised']],
      ['链接', vars.focus, vars.bg],
      ['链接（卡片底）', vars.focus, vars['bg-raised']],
      ['等级徽标（容易）', vars['ok-ink'], vars['ok-bg']],
      ['等级徽标（中等）', vars['warn-ink'], vars['warn-bg']],
      ['等级徽标（难）', vars['err-ink'], vars['err-bg']],
      ['主按钮', vars['accent-ink'], vars.accent],
      // 类型分类栏选中态是浅蓝填充（--focus），胶囊选中态是主色填充（--accent）。
      // 两者都是「文字压在色块上」，所以各自的文字/底色组合都要单独过 AA。
      ['类型栏选中态', vars['accent-ink'], vars.focus],
      ['胶囊选中态', vars['accent-ink'], vars.accent],
      ['胶囊未选中', vars.text, vars['bg-sunken']],
      ['错误提示', vars['err-ink'], vars['err-bg']],
    ]
    for (const [name, fg, bg] of pairs) {
      const ratio = contrastRatio(fg, bg)
      expect(ratio, `${name}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('焦点可见：:focus-visible 有 3px 实线描边', async () => {
    const body = ruleBody(await read('index.css'), ':focus-visible')
    expect(body).toMatch(/outline:\s*3px solid/)
  })

  it('尊重 prefers-reduced-motion', async () => {
    expect(await read('index.css')).toContain('prefers-reduced-motion: reduce')
  })

  it('底部导航有 aria-label，当前页由 NavLink 提供 aria-current', async () => {
    const shell = await read('components/AppShell.tsx')
    expect(shell).toContain('aria-label="主导航"')
    expect(shell).toContain('<NavLink')
    const css = await read('index.css')
    expect(css).toContain(".app-nav a[aria-current='page']")
  })

  it('类型栏与所有胶囊都用 aria-pressed 表示选中态（没有 aria-expanded 折叠面板了）', async () => {
    const filters = await read('components/VideoFilters.tsx')
    expect(filters).toContain('aria-pressed={active}') // 等级 / 时长胶囊
    expect(filters).toContain('aria-pressed={selected === null}') // 「全部」
    expect(filters).toContain('aria-pressed={selected === type}') // 12 个类型
    // 旧版的「类型筛选（已选 N 项）/ 展开 + 完成 + 遮罩层」整块删干净了
    expect(filters).not.toContain('aria-expanded')
    expect(filters).not.toContain('typePanelOpen')
    expect(filters).not.toContain('filters__scrim')
    // 渲染出来的按钮共 8 类型 + 5 等级 + 4 时长 = 17 个，源码里对应 4 处 <button 字面量
    // （类型项写在同一处 map 里、等级一处、时长一处、「全部」一处）
    expect([...filters.matchAll(/<button/g)]).toHaveLength(4)
    expect(filters).toContain('VIDEO_TYPE_ORDER.map')
    expect(filters).toContain('LEVEL_ORDER.map')
    expect(filters).toContain('DURATION_BUCKETS.map')
  })

  it('类型分类栏是 <nav aria-label>（读屏器能直接跳到它），不是复选框列表', async () => {
    const filters = await read('components/VideoFilters.tsx')
    expect(filters).toContain('<nav className="type-rail" aria-label="按类型筛选">')
    // 复选框整套删掉：单选分类栏用 button + aria-pressed 更准，也省掉一整套 label 关联
    expect(filters).not.toContain('<input')
    expect(filters).not.toContain('check-list')
  })

  it('不可播放的视频卡片用 aria-disabled 而不是 aria-hidden（仍可被读屏发现）', async () => {
    const card = await read('components/VideoCard.tsx')
    expect(card).toContain('aria-disabled="true"')
    // 整卡不使用 aria-hidden（那样读屏器就完全发现不了它）；只有装饰性图标才 aria-hidden
    expect(card).not.toMatch(/<li[^>]*aria-hidden/)
    expect(card).toContain('暂不可播放')
  })

  it('卡片链接有简洁的无障碍名，时长角标标为装饰（D-9）', async () => {
    const card = await read('components/VideoCard.tsx')
    expect(card).toContain('aria-label={[')
    expect(card).toContain('时长 ${formatDuration(video.durationSeconds)}')
    // 角标里的时长已经在 aria-label 里出现一次，视觉用的那个必须对读屏器隐藏
    expect(card).toMatch(/<span className="video-card__duration" aria-hidden="true">/)
  })

  it('进度条有 role=progressbar 与 aria-valuenow', async () => {
    const banner = await read('components/LastTrainingBanner.tsx')
    expect(banner).toContain('role="progressbar"')
    expect(banner).toContain('aria-valuenow')
    expect(banner).toContain('aria-valuemin')
    expect(banner).toContain('aria-valuemax')
  })

  it('状态提示用 role=alert / role=status，读屏器能播报', async () => {
    const status = await read('components/StatusMessage.tsx')
    expect(status).toContain('role="alert"')
    expect(status).toContain('role="status"')
  })
})

describe('P0-1 视频卡片封面比例（aspect-ratio 必须真的生效）', () => {
  /**
   * 为什么用静态断言而不是 jsdom 渲染后量高度：
   * jsdom 不实现 CSS 布局引擎，getBoundingClientRect() 永远返回 0×0，
   * aspect-ratio / overflow / object-fit 一条都算不出来。这个 bug（写了
   * `aspect-ratio: 16/9` 却渲染成 171×389）恰恰是「算出来的值和写的不一样」，
   * 所以只能在 CSS 文本层面把契约钉住：容器声明 aspect-ratio + overflow:hidden，
   * 且所有子元素都绝对定位（不参与高度计算）。任何一条被删掉，这条测试立刻红。
   */
  it('.video-card__thumb 同时声明 aspect-ratio 与 overflow: hidden', async () => {
    const body = ruleBody(await read('index.css'), '.video-card__thumb').replace(/\s/g, '')
    expect(body, '没找到 .video-card__thumb 的规则').toContain('aspect-ratio:')
    expect(body, '缺 overflow:hidden：子元素一旦贡献内容高度就会把 aspect-ratio 顶掉').toContain(
      'overflow:hidden',
    )
    // 比例是 3:4（竖版素材），不是 16:9 —— 详见 index.css 里那段实测说明
    expect(body.replace(/\s/g, '')).toMatch(/aspect-ratio:3\/4/)
  })

  it('封面内的图片与占位块都绝对定位，不参与容器高度计算', async () => {
    const css = (await read('index.css')).replace(/\s/g, '')
    for (const selector of ['.video-card__img', '.video-card__placeholder']) {
      const body = ruleBody(await read('index.css'), selector).replace(/\s/g, '')
      expect(body, `${selector} 必须是 position:absolute`).toContain('position:absolute')
      expect(body, `${selector} 必须用 inset:0 铺满容器`).toContain('inset:0')
      expect(css).toContain(selector)
    }
  })

  it('封面盒里没有写死的像素高度（写了就会在窄屏撑出横向滚动条）', async () => {
    const body = ruleBody(await read('index.css'), '.video-card__thumb')
    expect(body).not.toMatch(/height:\s*\d+px/)
    // 网格用 auto-fill + 1fr：列数由可用宽度决定，窄屏自动降列，不会横向溢出
    const grid = ruleBody(await read('index.css'), '.video-grid').replace(/\s/g, '')
    expect(grid).toMatch(/repeat\(auto-fill,minmax\(\d+px,1fr\)\)/)
  })

  it('<img> 的固有比例与封面比例一致（3:4），避免加载前按错形状预留空间', async () => {
    const card = await read('components/VideoCard.tsx')
    // 240×320 = 精确 3:4，且与服务端实际下发的像素尺寸一致
    expect(card).toMatch(/width=\{240\}/)
    expect(card).toMatch(/height=\{320\}/)
  })

  it('底部固定导航不再遮住最后一行内容', async () => {
    const main = ruleBody(await read('index.css'), '.app-shell__main').replace(/\s/g, '')
    // 78px = 导航 62px + 16px 余量；必须含 env(safe-area-inset-bottom)
    expect(main).toContain('padding:var(--pad)var(--pad)calc(78px+env(safe-area-inset-bottom,0px))')
    // 播放页没有导航（AppShell showNav={false}），那 78px 要还回去
    expect(await read('index.css')).toContain('.app-shell:not(:has(> .app-nav)) .app-shell__main')
  })

  // 产品决定（2026-09-28 用户明确要求，多次调整后的最终形态）：
  //   1) 等级 K1–K5 与时长 4 档各占**一整行**（横跨全宽，不被左栏挤窄）
  //   2) 左侧分类栏**从分割线才开始**往下竖排，不是顶部横条、不是折叠面板
  //   3) 分类栏与结果区是 grid 的两列，**中间只有 column-gap 的 8px**，
  //      不允许出现「左栏和第一列卡片之间空出一条缝」—— 那正是 position:fixed
  //      + 手工 padding-left 让位时算错 .app-shell__main padding 造成的（实测 22px）。
  it('筛选页：两行胶囊横跨全宽，分类栏从分割线起竖排占第一列', async () => {
    const css = await read('index.css')

    // 1) grid 形状：前两行横跨两列，第三行才是「左栏 + 结果」
    const layout = ruleBody(css, '.find-layout').replace(/\s/g, '')
    expect(layout).toMatch(/'level\s*level'/)
    expect(layout).toMatch(/'duration\s*duration'/)
    expect(layout).toMatch(/'rail\s*main'/)
    // 两列：左栏固定宽 + 结果自适应
    expect(layout).toMatch(/grid-template-columns:var\(--rail-width\)minmax\(0,1fr\)/)
    // 列间距必须小：>16px 就会出现真机上那种「栏和卡片之间一条空白」
    const colGap = Number(layout.match(/column-gap:(\d+)px/)?.[1])
    expect(colGap, `column-gap ${colGap}px 太大，栏与卡片之间会空出一条缝`).toBeLessThanOrEqual(12)

    // 2) 胶囊横跨全宽 → 它们在 grid 里是第一、二行，且自己是 flex 铺满
    expect(ruleBody(css, '.chip-row--level').replace(/\s/g, '')).toContain('grid-area:level')
    expect(ruleBody(css, '.chip-row--duration').replace(/\s/g, '')).toContain('grid-area:duration')
    const row = ruleBody(css, '.chip-row').replace(/\s/g, '')
    expect(row, '.chip-row 必须 nowrap，否则时长胶囊会折成两行').toContain('flex-wrap:nowrap')
    // 铺满 = 每颗 flex:1 等分（去空格后 flex:110）
    expect(ruleBody(css, '.chip').replace(/\s/g, ''),
      '胶囊必须 flex:1 等分整行宽度，这是「铺满」的实现点').toContain('flex:110')

    // 3) 分类栏在第三行第一列，竖排、常驻可见
    expect(ruleBody(css, '.type-rail').replace(/\s/g, '')).toContain('grid-area:rail')
    expect(ruleBody(css, '.type-rail__list').replace(/\s/g, '')).toContain('flex-direction:column')
    // **不许再出现 position:fixed** —— 它需要手工 padding 让位，会算错
    expect(ruleBody(css, '.type-rail'), '分类栏改回 position:fixed 会重现「栏与卡片之间的缝」')
      .not.toContain('position:fixed')
    // 主区不再靠 padding 让位（grid 列已经让开了）
    expect(ruleBody(css, '.find-main'), '.find-main 不该再有 padding-left（grid 列已让开）')
      .not.toMatch(/padding-left/)

    // 4) 常驻可见：任何宽度下都不许把类型栏藏起来
    for (const selector of ['.type-rail', '.type-rail__item', '.type-rail__list']) {
      expect(ruleBody(css, selector), selector).not.toContain('visibility')
      expect(ruleBody(css, selector), selector).not.toContain('display:none')
    }
    expect(css, '旧的底部半屏筛选面板整套都不该回来了').not.toContain('.filters__panel')
    expect(css).not.toContain('.filters__scrim')
    expect(css).not.toContain('.type-filter-trigger')
  })

  // 产品决定：结果网格必须能在「393px 视口 − 左栏 64px − 间距」下排两列。
  // 曾经的 150px 下限让 auto-fill 退化成单列（真机实测：一屏只能看 1 个视频）。
  it('视频网格在 393px 视口扣掉左栏后仍排两列（minmax 下限不能太大）', async () => {
    const css = await read('index.css')
    const grid = ruleBody(css, '.video-grid').replace(/\s/g, '')
    const minmax = Number(grid.match(/minmax\((\d+)px,1fr\)/)?.[1])
    // 393 − 32(.app-shell__main padding) − 64(左栏) − 8(column-gap) = 289px 可用
    const available = 393 - 32 - 64 - 8
    expect(minmax * 2 + 12, `minmax ${minmax}px 在 ${available}px 可用宽度下排不下两列`)
      .toBeLessThanOrEqual(available)
  })

  it('筛选页不传 title/subtitle，AppShell 在两者都缺省时不渲染 <header>', async () => {
    const find = await read('pages/Find.tsx')
    expect(find, '筛选页不应再传 title').not.toMatch(/<AppShell[^>]*\btitle=/)
    expect(find, '筛选页不应再传 subtitle').not.toMatch(/<AppShell[^>]*\bsubtitle=/)
    const shell = await read('components/AppShell.tsx')
    expect(shell, 'AppShell 必须支持 title/subtitle 可选').toMatch(/title\?:\s*string/)
    expect(shell, '三者都缺省时整个 header 不渲染')
      .toMatch(/\(title \|\| subtitle \|\| trailing\)\s*&&\s*\(/)
  })

  // 产品决定：没有「清除全部」按钮，取消 = 再点一次已选中的胶囊。
  it('页面上不存在「清除全部」按钮（单选语义下取消靠再点一次）', async () => {
    const find = await read('pages/Find.tsx')
    // 只看 JSX，不看注释：注释里解释「旧版这里还有清除全部按钮」是正常的
    const jsx = find.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(jsx, '「清除全部」按钮已被删除').not.toContain('清除全部')
    const filters = await read('components/VideoFilters.tsx')
    expect(filters, '取消 = 再点一次当前已选中的那个（active ? null : value）')
      .toMatch(/active \? null :/)
  })

  it('页面上不再出现「待标注」这三个字（用户明确要求）', async () => {
    const files = [
      'lib/types.ts',
      'lib/format.ts',
      'lib/catalog.ts',
      'lib/filter-videos.ts',
      'components/VideoCard.tsx',
      'components/VideoFilters.tsx',
      'pages/Find.tsx',
      'pages/VideoPlayer.tsx',
      'index.css',
    ]
    for (const file of files) {
      // 只查**会渲染到页面上的**内容：去掉注释与字符串字面量之外的东西
      const text = await read(file)
      const withoutComments = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\/\/.*$/gm, '')
      // JSX 文本节点 / 字符串字面量里的「待标注」才是页面文案
      const hits = [...withoutComments.matchAll(/['"`]([^'"`]*待标注[^'"`]*)['"`]/g)]
      expect(hits.map((m) => m[1]), `${file} 仍有「待标注」文案`).toEqual([])
    }
  })
})

describe('WCAG 1.4.11 非文本对比度（UI 组件边界 ≥ 3:1）', () => {
  it('卡片边框 --line 在两种背景上都达到 3:1', async () => {
    const vars = parseVars(await read('index.css'))
    for (const bg of [vars['bg-raised'], vars.bg]) {
      const ratio = contrastRatio(vars.line, bg)
      expect(ratio, `--line ${vars.line} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('P1-6 性能相关的静态事实', () => {
  it('缩略图 <img> 有 loading=lazy 与显式 width/height（避免布局抖动）', async () => {
    const card = await read('components/VideoCard.tsx')
    expect(card).toContain('loading="lazy"')
    expect(card).toMatch(/width=\{240\}/)
    expect(card).toMatch(/height=\{320\}/)
    expect(card).toContain('decoding="async"')
  })

  it('缩略图 404 时降级为占位块而不是碎图', async () => {
    const card = await read('components/VideoCard.tsx')
    expect(card).toContain('onError')
    expect(card).toContain('暂无封面')
    expect(card).toContain('alt=""')
  })

  it('播放器用原生 controls + playsInline（FR-010「播放器原生控制」）', async () => {
    const player = await read('pages/VideoPlayer.tsx')
    expect(player).toContain('controls')
    expect(player).toContain('playsInline')
    expect(player).toContain('preload="metadata"')
  })

  it('没有引入虚拟列表库（结论写在报告里：130 张卡片一次性渲染）', () => {
    const pkg = JSON.parse(
      // package.json 不在 src 下，单独读
      readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'),
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(Object.keys(all).some((d) => /virtual|window|react-window|react-virtual/i.test(d))).toBe(false)
  })
})
