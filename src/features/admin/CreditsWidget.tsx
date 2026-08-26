'use client'

import { type Lang } from '@/shared/i18n'
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Meter } from '@/shared/ui/Meter'
import { Alert } from '@/shared/ui/Alert'
import { fetchOpenRouterCredits } from './actions'
import { buttonClass } from '@/shared/ui/button-style'
import { Spinner } from '@/shared/ui/Spinner'

type Credits = { total: number; used: number; remaining: number }

/** Баланс OpenRouter: полоска расхода + кнопка «Обновить» (порт из aep). */
export function CreditsWidget({ lang }: { lang: Lang }) {
  const ru = lang === 'ru'
  const [c, setC] = useState<Credits | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    let res
    try {
      res = await fetchOpenRouterCredits()
    } finally {
      // Без finally сорвавшийся запрос оставлял бы вечный спиннер.
      setLoading(false)
    }
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
      className={buttonClass({ className: 'disabled:opacity-60' })}
    >
      {loading ? <Spinner size="xs" /> : <RefreshCw size={12} />}
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
    return <div className="text-[0.78125rem] text-muted">{loading ? (ru ? 'Получаем баланс…' : 'Loading balance…') : '—'}</div>
  }

  const pctUsed = c.total > 0 ? Math.min(100, Math.round((c.used / c.total) * 100)) : 0
  const barTone = c.remaining < 1 ? 'danger' : c.remaining < 5 ? 'warn' : 'ok'

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[0.8125rem]">
        <div className="text-ink">
          {ru ? 'Остаток:' : 'Remaining:'}{' '}
          <span className="font-mono font-semibold tabular-nums">${c.remaining.toFixed(2)}</span>
          <span className="ml-1 text-[0.78125rem] text-muted">
            {ru ? 'из' : 'of'} ${c.total.toFixed(2)}
          </span>
        </div>
        {refresh}
      </div>
      <Meter value={pctUsed / 100} tone={barTone} className="h-2" />
      <p className="text-[0.78125rem] text-muted">
        {ru ? 'Использовано' : 'Used'} ${c.used.toFixed(2)} ({pctUsed}%).
      </p>
    </div>
  )
}
