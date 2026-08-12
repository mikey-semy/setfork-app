'use client'

import { useEffect, useRef, useState } from 'react'
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { LiveMetrics } from './dashboard-types'

// Поллинг живых метрик админки вынесен из компонента: у плиток остаётся только
// вид, а «как часто дёргаем, когда считаем данные протухшими и что чистим при
// уходе» живёт одним куском.

/** Как часто спрашиваем метрики. SSE/вебсокетов в проекте нет. */
const POLL_MS = 15_000

/** Раз в столько тиков освежаем и серверную часть страницы (тренды, инбокс). */
const REFRESH_EVERY = 4

export function useLiveMetrics(initial: LiveMetrics, router: AppRouterInstance): { m: LiveMetrics; stale: boolean } {
  const [m, setM] = useState<LiveMetrics>(initial)
  const [stale, setStale] = useState(false)
  const ticks = useRef(0)

  useEffect(() => {
    // alive гасит ответы, пришедшие после ухода со страницы, а clearTimeout —
    // сам цикл: без обоих поллинг переживал бы размонтирование.
    let alive = true
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      try {
        const res = await fetch('/api/admin/metrics', { cache: 'no-store' })
        if (res.ok) {
          const data = (await res.json()) as LiveMetrics
          if (alive) {
            setM(data)
            setStale(false)
          }
          if (alive && ++ticks.current % REFRESH_EVERY === 0) router.refresh()
        } else if (alive) setStale(true)
      } catch {
        if (alive) setStale(true)
      }
      if (alive) timer = setTimeout(tick, POLL_MS)
    }

    timer = setTimeout(tick, POLL_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [router])

  return { m, stale }
}
