import '@testing-library/jest-dom/vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makePayload, makeVideo, renderApp, stubCatalogFetch } from './helpers'

/**
 * 找页的筛选器是**单选类型栏 + 等级/时长胶囊 + 排序下拉**。
 * 这里的夹具刻意造出 4 种不同难度 / 5 种不同等级 / 5 种不同时长，
 * 这样「点一个条件 → 结果立刻变」是真的被断言，而不是碰巧对上。
 */
const VIDEOS = [
  makeVideo({ id: 'a', title: '拉伸放松', types: ['stretch'], level: 'K1', durationSeconds: 180 }),
  makeVideo({ id: 'b', title: '核心训练', types: ['core'], level: 'K3', durationSeconds: 600 }),
  makeVideo({ id: 'c', title: '高难燃脂', types: ['cardio'], level: 'K5', durationSeconds: 2000 }),
  // level 为 null：还没从封面识图出等级，卡片上不出现徽标，等级筛选也不命中它
  makeVideo({ id: 'd', title: '没识图等级', types: ['core'], level: null, durationSeconds: 1200 }),
  makeVideo({ id: 'e', title: '打不开的', types: ['core'], level: 'K1', available: false }),
]

beforeEach(() => {
  window.localStorage.clear()
  stubCatalogFetch(makePayload(VIDEOS))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function click(el: Element) {
  fireEvent.click(el)
}

async function ready(route = '/find') {
  renderApp(route)
  await screen.findByRole('region', { name: '筛选结果' })
}

// 「共 N 个视频」那一行已按产品要求删除，筛选结果变化改由「结果网格里有几张卡」来断言。
// 骨架屏的 LoadingBlock 也有 role=status，所以这里直接数 .video-grid 里的卡片。
function count() {
  // 可用的卡片：available=true 的是 <a>，不可用的是 <li aria-disabled>。
  // 空筛选时不可用条目根本不进结果，所以只数 <a> 就等于「可播放的视频数」。
  return document.querySelectorAll('.video-grid > li > a.video-card').length
}

describe('Find · 类型分类栏（单选）', () => {
  it('13 项常驻可见：全部 + 12 个类型，没有「展开」「完成」按钮，也不需要遮罩层', async () => {
    await ready()
    const rail = screen.getByRole('navigation', { name: '按类型筛选' })
    // ⚠️ 4 个字的类型标签竖排两行渲染，可访问名是「上肢 力量」这种带空格的两段。
    for (const label of [
      '全部',
      '有氧',
      '全身 力量',
      '核心',
      '上肢 力量',
      '下肢 力量',
      '跑步 专项',
      '普拉提',
      '拉伸',
      '平衡',
      '瑜伽',
      '助眠',
      '八段锦',
    ]) {
      expect(within(rail).getByRole('button', { name: label }), label).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /类型筛选（已选/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '完成' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '关闭面板' })).not.toBeInTheDocument()
  })

  it('「全部」默认选中，点一下某类型就切过去（单选，不是多选）', async () => {
    await ready()
    const rail = () => screen.getByRole('navigation', { name: '按类型筛选' })
    expect(within(rail()).getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true')

    click(within(rail()).getByRole('button', { name: '核心' }))
    expect(within(rail()).getByRole('button', { name: '核心' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(rail()).getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'false')
    expect(count()).toBe(2)

    // 单选：再点另一个类型是**替换**，不是叠加
    click(within(rail()).getByRole('button', { name: '拉伸' }))
    expect(count()).toBe(1)
    expect(within(rail()).getByRole('button', { name: '核心' })).toHaveAttribute('aria-pressed', 'false')

    // 点「全部」回到不筛类型
    click(within(rail()).getByRole('button', { name: '全部' }))
    expect(count()).toBe(4)
  })

  // 产品决定（2026-09-28 用户明确）：三个维度全是**单选**。
  // 点 K1 → 只剩 K1；点 K3 → 替换成只剩 K3（不是叠加成 K1+K3）。
  it('等级是单选：点 K3 会替换掉 K1，不是叠加', async () => {
    await ready()
    click(screen.getByRole('button', { name: 'K1' }))
    expect(count()).toBe(1)
    expect(screen.getByRole('button', { name: 'K1' })).toHaveAttribute('aria-pressed', 'true')

    click(screen.getByRole('button', { name: 'K3' }))
    expect(screen.getByRole('button', { name: 'K1' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'K3' })).toHaveAttribute('aria-pressed', 'true')
    expect(count()).toBe(1)
    expect(screen.getByText('核心训练')).toBeInTheDocument()
    expect(screen.queryByText('拉伸放松')).not.toBeInTheDocument()
  })

  // 唯一的「取消」途径：再点一次当前已选中的胶囊。没有「清除全部」按钮。
  it('再点一次已选中的胶囊 = 取消（这就是清空的全部方式）', async () => {
    await ready()
    click(screen.getByRole('button', { name: 'K1' }))
    expect(count()).toBe(1)

    click(screen.getByRole('button', { name: 'K1' }))
    expect(screen.getByRole('button', { name: 'K1' })).toHaveAttribute('aria-pressed', 'false')
    expect(count()).toBe(4)

    // 时长同样：点两下回到不筛
    click(screen.getByRole('button', { name: '≥31min' }))
    expect(count()).toBe(1)
    click(screen.getByRole('button', { name: '≥31min' }))
    expect(count()).toBe(4)
  })

  it('页面上没有「清除全部」按钮', async () => {
    await ready()
    expect(screen.queryByRole('button', { name: /清除全部/ })).not.toBeInTheDocument()
  })
})

describe('Find · 等级筛选（K1–K5）', () => {
  it('难度一行渲染 5 个 K 胶囊，且页面上没有任何「待标注」字样', async () => {
    await ready()
    for (const level of ['K1', 'K2', 'K3', 'K4', 'K5']) {
      expect(screen.getByRole('button', { name: level })).toBeInTheDocument()
    }
    expect(document.body.textContent).not.toContain('待标注')
  })

  // 核心产品决定：还没识图出等级的条目不命中任何等级，绝不被算成 K1。
  it('level 为 null 的视频不命中任何等级（点 K2/K4 都不会出现「没识图等级」）', async () => {
    await ready()
    click(screen.getByRole('button', { name: 'K2' }))
    expect(count()).toBe(0)
    expect(screen.getByText('没有符合条件的视频')).toBeInTheDocument()
    expect(screen.queryByText('没识图等级')).not.toBeInTheDocument()

    click(screen.getByRole('button', { name: 'K2' }))
    click(screen.getByRole('button', { name: 'K4' }))
    expect(count()).toBe(0)
    expect(screen.queryByText('没识图等级')).not.toBeInTheDocument()

    // 不选等级时它照常出现，但卡片上没有等级徽标
    click(screen.getByRole('button', { name: 'K4' }))
    expect(screen.getByText('没识图等级')).toBeInTheDocument()
    const card = screen.getByText('没识图等级').closest('.video-card')
    expect(card?.querySelector('.level')).toBeNull()
  })

  it('类型 ∩ 等级 ∩ 时长取交集', async () => {
    await ready()
    click(within(screen.getByRole('navigation', { name: '按类型筛选' })).getByRole('button', { name: '核心' }))
    expect(count()).toBe(2)

    click(screen.getByRole('button', { name: 'K3' }))
    expect(count()).toBe(1)
    expect(screen.getByText('核心训练')).toBeInTheDocument()

    click(screen.getByRole('button', { name: '6-15min' }))
    expect(count()).toBe(1)
    expect(screen.getByText('核心训练')).toBeInTheDocument()
    // 三个维度各选中一个，同时只有一个胶囊处于按下态
    expect(screen.getByRole('button', { name: 'K3' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '6-15min' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Find · 时长胶囊', () => {
  it('时长一行使用 DURATION_BUCKETS 的短标签', async () => {
    await ready()
    for (const label of ['≤5min', '6-15min', '16-30min', '≥31min']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })
})

describe('Find · URL 还原与清除', () => {
  it('空筛选时只显示可播放的视频', async () => {
    await ready()
    expect(count()).toBe(4)
    expect(screen.queryByText('打不开的')).not.toBeInTheDocument()
    // 没有任何条件处于选中态
    for (const label of ['K1', 'K3', '≤5min', '≥31min']) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('query 参数能还原选择（level= 里放的是 K1–K5）', async () => {
    await ready('/find?types=core&level=K3&durations=gt5to15')
    expect(within(screen.getByRole('navigation', { name: '按类型筛选' })).getByRole('button', { name: '核心' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'K3' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '6-15min' })).toHaveAttribute('aria-pressed', 'true')
    expect(count()).toBe(1)
    expect(screen.getByText('核心训练')).toBeInTheDocument()
  })

  it('非法 query 静默回退，合法值仍生效', async () => {
    // 旧链接里 difficulty=beginner 这种 3 档值现在不再是合法等级 → 静默丢弃
    await ready('/find?types=core&level=beginner&durations=le99999')
    expect(within(screen.getByRole('navigation', { name: '按类型筛选' })).getByRole('button', { name: '核心' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // 非法值一律不生效：没有等级胶囊处于按下态
    for (const label of ['K1', 'K2', 'K3', 'K4', 'K5']) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false')
    }
    expect(count()).toBe(2)
  })

  // 没有「清除全部」按钮之后，恢复全量的唯一方式是逐个取消
  it('逐个取消已选项即可恢复全量（不需要清除按钮）', async () => {
    await ready()
    click(within(screen.getByRole('navigation', { name: '按类型筛选' })).getByRole('button', { name: '拉伸' }))
    click(screen.getByRole('button', { name: 'K1' }))
    expect(count()).toBe(1)

    click(screen.getByRole('button', { name: 'K1' }))
    // K1 取消后类型仍是「拉伸」→ 只剩 a 一条
    expect(count()).toBe(1)
    // 再点一次「拉伸」把它也取消掉（类型栏同样是单选+取消）
    click(within(screen.getByRole('navigation', { name: '按类型筛选' })).getByRole('button', { name: '拉伸' }))
    expect(count()).toBe(4)
  })

  it('空结果时给出「再点一次就能取消」的提示，且没有清除按钮', async () => {
    await ready()
    click(within(screen.getByRole('navigation', { name: '按类型筛选' })).getByRole('button', { name: '平衡' }))
    expect(screen.getByText('没有符合条件的视频')).toBeInTheDocument()
    expect(screen.getByText(/再点一次已选中的那个标签就能取消它/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /清除全部/ })).not.toBeInTheDocument()

    // 照着提示做：点「平衡」第二次就回来了
    click(within(screen.getByRole('navigation', { name: '按类型筛选' })).getByRole('button', { name: '平衡' }))
    expect(count()).toBe(4)
  })

  it('结果卡片点击进入播放页', async () => {
    await ready()
    const link = screen.getByText('拉伸放松').closest('a')
    expect(link).toHaveAttribute('href', '/video/a')
  })
})
