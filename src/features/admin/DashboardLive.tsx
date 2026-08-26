'use client'
import { useRouter } from 'next/navigation'
import { t, tr, type Lang } from '@/shared/i18n'
import { StatTile } from '@/shared/ui/StatTile'
import type { LiveMetrics } from './dashboard-types'
import { useLiveMetrics } from './use-live-metrics'

function money(n: number): string {
  return '$' + n.toFixed(n < 1 ? 4 : 2)
}
const NUM_FMT = new Intl.NumberFormat('en') // модульный уровень: пересборка форматтера на каждый вызов дорога
function num(n: number): string {
  return NUM_FMT.format(n)
}

/**
 * Живые плитки «Сейчас» и «Сегодня». Поллит /api/admin/metrics (no-store) — как GenerationChat,
 * т.к. SSE/вебсокетов в проекте нет. Раз в ~минуту дёргает router.refresh(), чтобы обновились
 * серверные графики трендов и счётчики инбокса на странице.
 */
export function DashboardLive({ initial, lang }: { initial: LiveMetrics; lang: Lang }) {
  const router = useRouter()
  const { m, stale } = useLiveMetrics(initial, router)

  const online = m.umamiConfigured ? m.onlineAll : m.onlineAuth
  const onlineSub = m.umamiConfigured
    ? t('admin.loggedInN', lang).replace('{n}', num(m.onlineAuth))
    : t('admin.loggedOnlyUmamiNot', lang)

  const capPct = m.dailyCap > 0 ? Math.min(100, (m.spendToday / m.dailyCap) * 100) : 0
  const capTone = capPct >= 90 ? 'danger' : capPct >= 70 ? 'warn' : 'ink'
  const queueDepth = m.queue.pending + m.queue.processing

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-body font-semibold uppercase tracking-wide text-ink-2">{t('admin.now', lang)}</h2>
        <span className="flex items-center gap-1.5 text-caption text-muted">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${stale ? 'bg-warn' : 'bg-ok'}`} />
          {stale ? t('admin.reconnecting', lang) : t('admin.live', lang)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t('admin.onlineNow', lang)}
          value={online == null ? '—' : num(online)}
          hint={onlineSub}
          tone="accent"
        />
        <StatTile
          label={t('admin.spentToday', lang)}
          value={money(m.spendToday)}
          tone={capTone}
          hint={
            <span className="flex flex-col gap-1">
              <span>
                {m.dailyCap > 0
                  ? t('admin.ofCapN', lang).replace('{v}', String(m.dailyCap))
                  : t('admin.dailyCapOff', lang)}
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
          label={t('admin.openRouterBalance', lang)}
          value={m.balance == null ? '—' : money(m.balance)}
          hint={
            m.runwayGens != null
              ? t('admin.approxGens', lang).replace('{n}', num(m.runwayGens))
              : undefined
          }
        />
        <StatTile
          label={t('admin.generationQueue', lang)}
          value={num(queueDepth)}
          tone={m.queue.failed > 0 ? 'warn' : 'ink'}
          hint={t('admin.inProgressFailed', lang).replace('{a}', String(m.queue.processing)).replace('{b}', String(m.queue.failed))}
        />
      </div>

      <h2 className="mt-2 text-body font-semibold uppercase tracking-wide text-ink-2">{t('admin.today', lang)}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t('admin.generations2', lang)}
          value={num(m.today.generations)}
          hint={m.today.generationsFailed > 0 ? t('admin.failedN', lang).replace('{n}', String(m.today.generationsFailed)) : undefined}
        />
        <StatTile label={t('admin.newUsers', lang)} value={num(m.today.signups)} />
        <StatTile
          label={t('admin.newLists', lang)}
          value={num(m.today.newLists)}
          hint={t('admin.publishedN', lang).replace('{n}', String(m.today.published))}
        />
        <StatTile label={t('admin.forks', lang)} value={num(m.today.forks)} />
      </div>
    </div>
  )
}
