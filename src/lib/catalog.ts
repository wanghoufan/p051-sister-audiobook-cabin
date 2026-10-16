import type { CatalogDiagnostic, CatalogResponse, CatalogState, Level, Video, VideoType } from './types'

export const CATALOG_ENDPOINT = '/api/videos'

const LEVELS: readonly Level[] = ['K1', 'K2', 'K3', 'K4', 'K5']
const VIDEO_TYPES: readonly VideoType[] = [
  'cardio', 'upper', 'lower', 'fullbody', 'core', 'stretch',
  'balance', 'running', 'pilates', 'sleep', 'yoga', 'baduanjin',
]
const DIAGNOSTIC_KINDS: readonly CatalogDiagnostic['kind'][] = [
  'unreadable',
  'missing',
  'duplicate',
  'metadata',
  'hidden',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(source: Record<string, unknown>, key: string, where: string): string {
  const value = source[key]
  if (typeof value !== 'string') {
    throw new Error(`${where} 的字段 ${key} 应该是字符串，实际是 ${describeValue(value)}`)
  }
  return value
}

function requireBoolean(source: Record<string, unknown>, key: string, where: string): boolean {
  const value = source[key]
  if (typeof value !== 'boolean') {
    throw new Error(`${where} 的字段 ${key} 应该是布尔值，实际是 ${describeValue(value)}`)
  }
  return value
}

function requireFiniteNumber(source: Record<string, unknown>, key: string, where: string): number {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${where} 的字段 ${key} 应该是有限数字，实际是 ${describeValue(value)}`)
  }
  return value
}

function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return '数组'
  return typeof value
}

/**
 * 单条视频的运行时校验。结构性问题（缺字段、类型不对、types 不是数组）直接抛错，
 * 因为那说明服务端返回的东西根本不是我们约定的格式，页面应该显示失败而不是展示错数据。
 * 只有「等级」这一个标签类字段做了容错：level 非法/缺失一律归一为 null ——
 * 干脆不显示任何等级，而不是谎称一个。
 */
function validateVideo(raw: unknown, index: number): Video {
  const where = `videos[${index}]`
  if (!isRecord(raw)) {
    throw new Error(`${where} 应该是对象，实际是 ${describeValue(raw)}`)
  }
  if (!Array.isArray(raw.types)) {
    throw new Error(`${where} 的字段 types 应该是数组，实际是 ${describeValue(raw.types)}`)
  }
  const types: VideoType[] = []
  for (const item of raw.types) {
    if (typeof item === 'string' && (VIDEO_TYPES as readonly string[]).includes(item)) {
      types.push(item as VideoType)
    }
    // 非法类型值直接丢弃：类型标签是「锦上添花」的信息，丢一个不会让视频打不开，
    // 而抛错会让整个列表不可用，对 60+ 用户来说代价太大。
  }

  // 等级只认封面原图上印的 K1–K5，字段缺失或非法一律 null，**绝不猜一个**。
  const rawLevel = raw.level
  const level: Level | null =
    typeof rawLevel === 'string' && (LEVELS as readonly string[]).includes(rawLevel) ? (rawLevel as Level) : null

  const rawThumbnail = raw.thumbnailUrl
  if (rawThumbnail !== null && typeof rawThumbnail !== 'string') {
    throw new Error(`${where} 的字段 thumbnailUrl 应该是字符串或 null，实际是 ${describeValue(rawThumbnail)}`)
  }

  return {
    id: requireString(raw, 'id', where),
    relativePath: requireString(raw, 'relativePath', where),
    title: requireString(raw, 'title', where),
    durationSeconds: requireFiniteNumber(raw, 'durationSeconds', where),
    types,
    level,
    hasThumbnail: requireBoolean(raw, 'hasThumbnail', where),
    thumbnailUrl: rawThumbnail as string | null,
    playbackUrl: requireString(raw, 'playbackUrl', where),
    available: requireBoolean(raw, 'available', where),
  }
}

function validateDiagnostic(raw: unknown, index: number): CatalogDiagnostic {
  const where = `diagnostics[${index}]`
  if (!isRecord(raw)) {
    throw new Error(`${where} 应该是对象，实际是 ${describeValue(raw)}`)
  }
  const kind = raw.kind
  if (typeof kind !== 'string' || !(DIAGNOSTIC_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`${where} 的字段 kind 不是合法的诊断类型，实际是 ${describeValue(kind)}`)
  }
  return {
    path: requireString(raw, 'path', where),
    kind: kind as CatalogDiagnostic['kind'],
    message: requireString(raw, 'message', where),
  }
}

/**
 * 校验 /api/videos 的响应体，坏数据抛中文错误。
 * 被容错的只有 level（非法/缺失 → null），其余结构问题一律抛错。
 */
export function validateCatalogResponse(data: unknown): CatalogResponse {
  if (!isRecord(data)) {
    throw new Error(`视频目录数据格式不对：顶层应该是对象，实际是 ${describeValue(data)}`)
  }
  if (!Array.isArray(data.videos)) {
    throw new Error(`视频目录数据格式不对：videos 应该是数组，实际是 ${describeValue(data.videos)}`)
  }
  if (!Array.isArray(data.diagnostics)) {
    throw new Error(
      `视频目录数据格式不对：diagnostics 应该是数组，实际是 ${describeValue(data.diagnostics)}`,
    )
  }
  return {
    videos: data.videos.map(validateVideo),
    diagnostics: data.diagnostics.map(validateDiagnostic),
    generatedAt: requireString(data, 'generatedAt', '顶层数据'),
  }
}

/**
 * 拉取视频目录。所有失败都抛出带中文提示的错误，
 * 让页面在「Mac Mini 关了 / WiFi 断了 / 服务重启中」时也能给出能看懂的话（SPEC FR-009）。
 */
export async function fetchCatalog(signal?: AbortSignal): Promise<CatalogResponse> {
  let response: Response
  try {
    response = await fetch(CATALOG_ENDPOINT, {
      signal,
      headers: { Accept: 'application/json' },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    throw new Error('连不上家里的 Mac Mini，请确认 Mac 已开机、WiFi 正常，然后下拉刷新再试一次。')
  }

  if (!response.ok) {
    throw new Error(
      `视频服务返回了 ${response.status} 错误，请稍后重试；若持续出现，请重启 Mac 上的服务。`,
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('视频服务返回的不是可识别的数据，可能是服务正在重启，请稍后重试。')
  }

  return validateCatalogResponse(payload)
}

/**
 * 把一份已通过 validateCatalogResponse 的响应映射成 CatalogState。
 *
 * 以前这段四态转换是硬编码在 CatalogProvider 的 setState 里的，其中
 * 「videos.length === 0 → empty」是一条没人写在任何地方的隐含约定。
 * 现在它是一个纯函数，谁想判断「这次目录算不算空」都用同一份逻辑。
 *
 * 约定：只有**一条视频都没有**才算 empty；`available: false` 的视频仍然算「有视频」，
 * 它们会让首页展示不可播放的占位状态（SC-002：坏文件不阻止其他视频展示）。
 */
export function toCatalogState(payload: CatalogResponse): CatalogState {
  if (payload.videos.length === 0) return { status: 'empty' }
  return {
    status: 'ready',
    videos: payload.videos,
    diagnostics: payload.diagnostics,
    generatedAt: payload.generatedAt,
  }
}

/**
 * 把任意异常转成一句可展示的中文提示。
 * AbortError 视为用户主动取消，返回空串，调用方据此不弹错误条。
 */
export function describeCatalogError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') return ''
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  return '视频目录读取失败，请稍后重试。'
}
