'use client'

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Alert } from '@/shared/ui/Alert'
import { fetchOpenRouterCredits } from './actions'

type Credits = { total: number; used: number; remaining: number }

/** Баланс OpenRouter: полоска расхода + кнопка «Обновить» (порт из aep). */
export function CreditsWidget({ ru }: { ru: boolean }) {
  const [c, setC] = useState<Credits | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    const res = await fetchOpenRouterCredits()
    setLoading(false)
    if ('error' in res) {
      setError(res.error)
      return
    }
    setC({ total: res.total, used: res.used, remaining: res.remaining })
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = (
    <button
      type="button"
      onClick={load}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12.5px] text-ink-2 hover:border-border-strong disabled:opacity-60"
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
      {ru ? 'Обновить' : 'Refresh'}
    </button>
  )

  if (error) {
    return (
      <Alert variant="warn">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{error}</span>
          {refresh}
        </div>
      </Alert>
    )
  }

  if (!c) {
    return <div className="text-[12.5px] text-muted">{loading ? (ru ? 'Получаем баланс…' : 'Loading balance…') : '—'}</div>
  }

  const pctUsed = c.total > 0 ? Math.min(100, Math.round((c.used / c.total) * 100)) : 0
  const barColor = c.remaining < 1 ? 'var(--danger)' : c.remaining < 5 ? 'var(--warn)' : 'var(--ok)'

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
        <div className="text-ink">
          {ru ? 'Остаток:' : 'Remaining:'}{' '}
          <span className="font-mono font-semibold tabular-nums">${c.remaining.toFixed(2)}</span>
          <span className="ml-1 text-[12.5px] text-muted">
            {ru ? 'из' : 'of'} ${c.total.toFixed(2)}
          </span>
        </div>
        {refresh}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-(--border)">
        <div className="h-full transition-all" style={{ width: `${pctUsed}%`, background: barColor }} />
      </div>
      <p className="text-[12.5px] text-muted">
        {ru ? 'Использовано' : 'Used'} ${c.used.toFixed(2)} ({pctUsed}%).
      </p>
    </div>
  )
}
