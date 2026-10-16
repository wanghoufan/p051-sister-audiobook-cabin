import { createContext, useContext } from 'react'
import type { CatalogState } from '../lib/types'

export interface CatalogValue {
  state: CatalogState
  /** 重新拉取目录（错误页的「再试一次」用）。 */
  reload: () => void
}

export const CatalogContext = createContext<CatalogValue | null>(null)

export function useCatalog(): CatalogValue {
  const value = useContext(CatalogContext)
  if (!value) throw new Error('useCatalog 必须在 CatalogProvider 内部使用')
  return value
}
