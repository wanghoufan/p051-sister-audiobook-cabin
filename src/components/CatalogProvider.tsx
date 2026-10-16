import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { describeCatalogError, fetchCatalog } from '../lib/catalog'
import type { CatalogState } from '../lib/types'
import { CatalogContext } from './catalog-context'
import type { CatalogValue } from './catalog-context'

const INITIAL: CatalogState = { status: 'loading' }

/**
 * 目录数据的唯一来源：只调用 lib 层现成的 fetchCatalog / describeCatalogError，
 * 自己只负责把结果映射成 CatalogState 的四种状态（loading / ready / error / empty）。
 */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CatalogState>(INITIAL)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    setState(INITIAL)
    fetchCatalog(controller.signal)
      .then((payload) => {
        if (!alive) return
        setState(
          payload.videos.length === 0
            ? { status: 'empty' }
            : {
                status: 'ready',
                videos: payload.videos,
                diagnostics: payload.diagnostics,
                generatedAt: payload.generatedAt,
              },
        )
      })
      .catch((err: unknown) => {
        if (!alive) return
        const message = describeCatalogError(err)
        if (message === '') return
        setState({ status: 'error', message })
      })
    return () => {
      alive = false
      controller.abort()
    }
  }, [attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const value = useMemo<CatalogValue>(() => ({ state, reload }), [state, reload])

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}
