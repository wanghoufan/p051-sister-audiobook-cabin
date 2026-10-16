/**
 * 前端基础类型 + 展示用常量/文案表。
 *
 * 难度只有一套体系：`level`（K1–K5），直接读自课程封面原图上印的等级。
 * 旧的 `difficulty`（beginner/intermediate/advanced 三档）已于 2026-09-29 **整体删除** ——
 * 它从来不是 Keep 的体系，与 K 值也不线性对应（一条标 advanced 的「引体向上 10-19 个」
 * 封面印的是 K3），留着只会诱导人去写一张错的映射表。
 * `level` 没识别出来就是 `null`：既不猜一个等级，也不在页面上放任何占位标签（SPEC 原则 IV）。
 */

export type VideoType =
  | 'cardio'
  | 'upper'
  | 'lower'
  | 'fullbody'
  | 'core'
  | 'stretch'
  | 'balance'
  | 'running'
  | 'pilates'
  | 'sleep'
  | 'yoga'
  | 'baduanjin'
export type DurationBucketId = 'le5' | 'gt5to15' | 'gt15to30' | 'gt30'

/**
 * 等级（K1–K5），与课程封面原图上印的标注逐条一致。
 * 纯数字不带汉字：胶囊按钮要横排一行，汉字会让宽度翻倍。
 */
export type Level = 'K1' | 'K2' | 'K3' | 'K4' | 'K5'

/** 等级胶囊的展示顺序：从最轻到最难，和封面上的编号顺序一致。 */
export const LEVEL_ORDER: readonly Level[] = ['K1', 'K2', 'K3', 'K4', 'K5']

export interface Video {
  id: string
  relativePath: string
  title: string
  durationSeconds: number
  types: VideoType[]
  /**
   * 封面原图上印的等级；还没识别出来、或标注里的值非法时为 null。
   * null 的三个合法来源：标注没这个字段、字段值不是 K1–K5、整条标注缺失。
   * **null 绝不退化成 K1**：60+ 的用户会照着标签去练，错标比不标危险。
   */
  level: Level | null
  hasThumbnail: boolean
  thumbnailUrl: string | null
  playbackUrl: string
  available: boolean
}

export interface CatalogDiagnostic {
  path: string
  kind: 'unreadable' | 'missing' | 'duplicate' | 'metadata' | 'hidden'
  message: string
}

export interface CatalogResponse {
  videos: Video[]
  diagnostics: CatalogDiagnostic[]
  generatedAt: string
}

export type CatalogState =
  | { status: 'loading' }
  | { status: 'ready'; videos: Video[]; diagnostics: CatalogDiagnostic[]; generatedAt: string }
  | { status: 'error'; message: string }
  | { status: 'empty' }

/**
 * 视频类型的中文标签；键必须是全部 VideoType，避免 UI 自己再写一遍。
 *
 * ⚠️ 上肢/下肢/全身这三个标签是 **4 个字**（上肢力量/下肢力量/全身力量）：
 * 在 44px 触控高的胶囊里横排一行会把整列撑爆，所以这三个在 UI 里**竖排两行**
 * 显示（见 `TYPE_LABEL_TWO_LINE` 与样式里的 `.type-chip--two-line`）。
 * 其余 2 个字的一律一行。
 */
export const VIDEO_TYPE_LABELS: Record<VideoType, string> = {
  cardio: '有氧',
  upper: '上肢力量',
  lower: '下肢力量',
  fullbody: '全身力量',
  core: '核心',
  stretch: '拉伸',
  balance: '平衡',
  running: '跑步专项',
  pilates: '普拉提',
  sleep: '助眠',
  yoga: '瑜伽',
  baduanjin: '八段锦',
}

/**
 * 竖排两行显示的判定：**标签 4 个字就拆两行**（上肢力量 / 下肢力量 / 全身力量 / 跑步专项）。
 *
 * 按字数判断而不是维护一份白名单 —— 新增类型时只要中文标签是 4 个字就自动两行，
 * 不会漏。2 个字的（有氧/核心/拉伸/平衡/助眠/瑜伽）一行，3 个字的（普拉提/八段锦）一行。
 */
function needsTwoLine(label: string): boolean {
  return label.length >= 4
}

/**
 * 把类型标签拆成显示用的行。
 *
 * 4 个字的标签在 64px 宽的分类栏和卡片药丸里横排一行会溢出，所以竖排两行
 * （「上肢」/「力量」）。UI 一律用这个函数渲染，不要直接写
 * `VIDEO_TYPE_LABELS[type]` —— 否则两行规则会被漏掉某处，
 * 同一个标签在筛选页和卡片上显示得不一样。
 */
export function typeLabelLines(type: VideoType): string[] {
  const label = VIDEO_TYPE_LABELS[type]
  return needsTwoLine(label) ? [label.slice(0, 2), label.slice(2)] : [label]
}

/** 标签是否需要竖排两行。给 UI 加 class 用，避免各处重复判断。 */
export function isTwoLineType(type: VideoType): boolean {
  return needsTwoLine(VIDEO_TYPE_LABELS[type])
}

/** 筛选按钮的展示顺序：先大类（全身力量/有氧/核心），再局部（上下肢力量），最后辅助类。 */
export const VIDEO_TYPE_ORDER: readonly VideoType[] = [
  'cardio',
  'fullbody',
  'core',
  'upper',
  'lower',
  'running',
  'pilates',
  'stretch',
  'balance',
  'yoga',
  'sleep',
  'baduanjin',
]

/**
 * 时长分桶。边界为半开区间，与 SPEC FR-005 一致：
 * 300 秒归 le5、300.001 归 gt5to15；900 归 gt5to15、900.001 归 gt15to30；
 * 1800 归 gt15to30、1800.001 归 gt30。
 *
 * 标签刻意写短（`≤5min` 而不是「5 分钟以内」）：这 4 个胶囊要和 5 个等级胶囊
 * 挤在同一列里，写长了会把整列撑成三排、把视频网格压到首屏以下。
 * **边界数值是契约，一个都不能动** —— 动了就是给用户错分时长桶。
 */
export const DURATION_BUCKETS: readonly {
  id: DurationBucketId
  label: string
  minSeconds: number
  maxSeconds: number
}[] = [
  { id: 'le5', label: '≤5min', minSeconds: 0, maxSeconds: 300 },
  { id: 'gt5to15', label: '6-15min', minSeconds: 300, maxSeconds: 900 },
  { id: 'gt15to30', label: '16-30min', minSeconds: 900, maxSeconds: 1800 },
  { id: 'gt30', label: '≥31min', minSeconds: 1800, maxSeconds: Infinity },
]
