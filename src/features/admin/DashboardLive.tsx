'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { tr, type Lang } from '@/shared/i18n'
import { StatTile } from '@/shared/ui/StatTile'
import type { LiveMetrics } from './dashboard-types'

const POLL_MS = 15_000
const REFRESH_EVERY = 4 // раз в ~минуту освежаем и серверную часть (тренды/инбокс) через router.refresh()

function money(n: number): string {
  return '$' + n.toFixed(n < 1 ? 4 : 2)
}
function num(n: number): string {
  return new Intl.NumberFormat('en').format(n)
}

/**
 * Живые плитки «Сейчас» и «Сегодня». Поллит /api/admin/metrics (no-store) — как GenerationChat,
 * т.к. SSE/вебсокетов в проекте нет. Раз в ~минуту дёргает router.refresh(), чтобы обновились
 * серверные графики трендов и счётчики инбокса на странице.
 */
export function DashboardLive({ initial, lang }: { initial: LiveMetrics; lang: Lang }) {
  const [m, setM] = useState<LiveMetrics>(initial)
  const [stale, setStale] = useState(false)
  const router = useRouter()
  const ticks = useRef(0)

  useEffect(() => {
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

  const online = m.umamiConfigured ? m.onlineAll : m.onlineAuth
  const onlineSub = m.umamiConfigured
    ? tr({ en: `logged-in: ${num(m.onlineAuth)}`, ru: `вошедших: ${num(m.onlineAuth)}` }, lang)
    : tr({ en: 'logged-in only (Umami not set up)', ru: 'только вошедшие (Umami не настроен)' }, lang)

  const capPct = m.dailyCap > 0 ? Math.min(100, (m.spendToday / m.dailyCap) * 100) : 0
  const capTone = capPct >= 90 ? 'danger' : capPct >= 70 ? 'warn' : 'ink'
  const queueDepth = m.queue.pending + m.queue.processing

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-2">{tr({ en: 'Now', ru: 'Сейчас' }, lang)}</h2>
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${stale ? 'bg-warn' : 'bg-ok'}`} />
          {stale ? tr({ en: 'reconnecting…', ru: 'переподключение…' }, lang) : tr({ en: 'live', ru: 'вживую' }, lang)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={tr({ en: 'Online now', ru: 'Онлайн сейчас' }, lang)}
          value={online == null ? '—' : num(online)}
          hint={onlineSub}
          tone="accent"
        />
        <StatTile
          label={tr({ en: 'Spent today', ru: 'Расход сегодня' }, lang)}
          value={money(m.spendToday)}
          tone={capTone}
          hint={
            <span className="flex flex-col gap-1">
              <span>
                {m.dailyCap > 0
                  ? tr({ en: `of $${m.dailyCap} cap`, ru: `из $${m.dailyCap} капа` }, lang)
                  : tr({ en: 'daily cap off', ru: 'дневной кап выключен' }, lang)}
              </span>
              {m.dailyCap > 0 && (
                <span className="block h-1 w-full overflow-hidden rounded-full bg-surface-2">
                  <span
                    className={`block h-full rounded-full ${capPct >= 90 ? 'bg-danger' : capPct >= 70 ? 'bg-warn' : 'bg-ok'}`}
                    style={{ width: `${capPct}%` }}
                  />
                </span>
              )}
            </span>
          }
        />
        <StatTile
          label={tr({ en: 'OpenRouter balance', ru: 'Остаток OpenRouter' }, lang)}
          value={m.balance == null ? '—' : money(m.balance)}
          hint={
            m.runwayGens != null
              ? tr({ en: `≈ ${num(m.runwayGens)} generations`, ru: `≈ ${num(m.runwayGens)} генераций` }, lang)
              : undefined
          }
        />
        <StatTile
          label={tr({ en: 'Generation queue', ru: 'Очередь генераций' }, lang)}
          value={num(queueDepth)}
          tone={m.queue.failed > 0 ? 'warn' : 'ink'}
          hint={tr(
            { en: `in progress ${m.queue.processing}, failed ${m.queue.failed}`, ru: `в работе ${m.queue.processing}, упало ${m.queue.failed}` },
            lang,
          )}
        />
      </div>

      <h2 className="mt-2 text-[13px] font-semibold uppercase tracking-wide text-ink-2">{tr({ en: 'Today', ru: 'Сегодня' }, lang)}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={tr({ en: 'Generations', ru: 'Генераций' }, lang)}
          value={num(m.today.generations)}
          hint={m.today.generationsFailed > 0 ? tr({ en: `failed ${m.today.generationsFailed}`, ru: `упало ${m.today.generationsFailed}` }, lang) : undefined}
        />
        <StatTile label={tr({ en: 'New users', ru: 'Новых юзеров' }, lang)} value={num(m.today.signups)} />
        <StatTile
          label={tr({ en: 'New lists', ru: 'Новых списков' }, lang)}
          value={num(m.today.newLists)}
          hint={tr({ en: `published ${m.today.published}`, ru: `опубл. ${m.today.published}` }, lang)}
        />
        <StatTile label={tr({ en: 'Forks', ru: 'Форков' }, lang)} value={num(m.today.forks)} />
      </div>
    </div>
  )
}
