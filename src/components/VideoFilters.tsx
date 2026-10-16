import {
  DURATION_BUCKETS,
  isTwoLineType,
  LEVEL_ORDER,
  typeLabelLines,
  VIDEO_TYPE_ORDER,
} from '../lib/types'
import type { DurationBucketId } from '../lib/types'
import type { FilterState } from '../lib/filter-videos'

interface FilterGroupProps {
  filters: FilterState
  onChange: (next: FilterState) => void
}

/**
 * 等级（K1–K5）胶囊组。**单选**：点 K1 就只剩 K1，再点 K1 取消。
 *
 * 这里**不提供「未识别」这个选项**：等级是从课程封面原图上人工识图补齐的，
 * 还没补齐的条目 level 是 null，而 null 在 matchesFilters 里不命中任何等级。
 * 代价是点 K2 可能看到 0 条 —— 这是诚实信号（「还没识别」），
 * 好过用一个猜出来的等级把 60+ 的用户骗着去练一个他做不下来的动作。
 * 页面文案里也不出现任何「待标注」字样（用户明确要求）。
 */
function LevelGroup({ filters, onChange }: FilterGroupProps) {
  return (
    <div className="chip-row chip-row--level" aria-label="按等级筛选">
      {LEVEL_ORDER.map((level) => {
        const active = filters.level === level
        return (
          <button
            type="button"
            key={level}
            className="chip chip--level"
            aria-pressed={active}
            onClick={() =>
              // 单选 + 取消：再点当前已选中的那个 = 回到「不按等级筛」
              onChange({ ...filters, level: active ? null : level })
            }
          >
            {level}
          </button>
        )
      })}
    </div>
  )
}

/** 时长胶囊组。**单选**，取消方式与等级组一致。 */
function DurationGroup({ filters, onChange }: FilterGroupProps) {
  return (
    <div className="chip-row chip-row--duration" aria-label="按时长筛选">
      {DURATION_BUCKETS.map((bucket) => {
        const active = filters.duration === bucket.id
        return (
          <button
            type="button"
            key={bucket.id}
            className="chip"
            aria-pressed={active}
            onClick={() =>
              onChange({ ...filters, duration: active ? null : (bucket.id as DurationBucketId) })
            }
          >
            {bucket.label}
          </button>
        )
      })}
    </div>
  )
}

interface VideoFiltersProps {
  filters: FilterState
  onChange: (next: FilterState) => void
}

/**
 * 筛选控件。
 *
 * 三个网格区域（class 决定了它们在 .find-layout 里各占哪一格）：
 *   .chip-row--level              —— 等级 K1–K5，**铺满整行**，**单选**
 *   .chip-row--duration           —— 时长 4 档，**铺满整行**，**单选**
 *   .type-rail                    —— 左侧常驻分类栏，**单选**（「全部」= 不筛类型）
 *
 * **左栏从分割线才开始**（产品决定 2026-09-28）：上方整块宽度让给两行胶囊，
 * 胶囊才能铺满；分类栏只在「筛选条件 ↔ 视频结果」这条分割线以下才出现。
 *
 * 三个维度都是单选，维度之间取交集：K1 + ≤5min = 「等级 K1 且时长 ≤5min」。
 * 取消任一条件 = **再点一次当前已选中的那个胶囊**。页面没有「清除全部」按钮。
 *
 * **没有 legend 文字**（「难度」「时长」两个词）：胶囊本身就是标签，
 * 那两个字在真机上各占一行高度，且不带任何新信息。改用 aria-label 保留语义。
 */
export function VideoFilters({ filters, onChange }: VideoFiltersProps) {
  const selected = filters.types[0] ?? null
  return (
    <>
      <LevelGroup filters={filters} onChange={onChange} />
      <DurationGroup filters={filters} onChange={onChange} />
      <nav className="type-rail" aria-label="按类型筛选">
        <ul className="type-rail__list">
          <li>
            <button
              type="button"
              className="type-rail__item"
              aria-pressed={selected === null}
              onClick={() => onChange({ ...filters, types: [] })}
            >
              全部
            </button>
          </li>
          {VIDEO_TYPE_ORDER.map((type) => (
            <li key={type}>
              <button
                type="button"
                className={`type-rail__item${isTwoLineType(type) ? ' type-rail__item--two-line' : ''}`}
                aria-pressed={selected === type}
                // 单选 + 取消：再点当前已选中的那个 = 回到「全部」。
                // 「全部」本身也走这条路径（selected === null 时点它等于没变）。
                onClick={() => onChange({ ...filters, types: selected === type ? [] : [type] })}
              >
                {typeLabelLines(type).map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  )
}
