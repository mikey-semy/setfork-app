'use client'

import { useEffect, useState } from 'react'
import { loadActivityDetails } from './details-actions'
import type { DetailsPage, DetailsRequest, ListEvent, TopicList } from './types'

// Детали раскрытия грузятся при ПОЯВЛЕНИИ блока: закрытый уровень просто не
// смонтирован, поэтому состояние «открыт» держит родитель, а не хук.

export interface Details<T> {
  page: DetailsPage<T> | null
  loading: boolean
  failed: boolean
  retry: () => void
}

/** Ответы переживают сворачивание: второй раз тот же уровень открывается мгновенно. */
const cache = new Map<string, DetailsPage<TopicList | ListEvent>>()

const keyOf = (handle: string, req: DetailsRequest) => `${handle}:${req.kind}:${req.windowKey}:${req.listId ?? ''}`

export function useDetails<T extends TopicList | ListEvent>(handle: string, req: DetailsRequest): Details<T> {
  const key = keyOf(handle, req)
  const [page, setPage] = useState<DetailsPage<T> | null>(() => (cache.get(key) as DetailsPage<T>) ?? null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (cache.has(key)) {
      setPage(cache.get(key) as DetailsPage<T>)
      return
    }
    // Пока ответ летит, применять его к УЖЕ ДРУГОМУ уровню нельзя: пользователь
    // успевает свернуть один список и раскрыть соседний.
    let alive = true
    setFailed(false)
    loadActivityDetails(handle, req)
      .then((got) => {
        cache.set(key, got)
        if (alive) setPage(got as DetailsPage<T>)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
    // req — литерал на каждый рендер, поэтому зависимость по его ключу.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])

  return { page, failed, loading: !page && !failed, retry: () => setAttempt((n) => n + 1) }
}
