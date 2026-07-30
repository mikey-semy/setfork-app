import Link from 'next/link'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { tr } from '@/shared/i18n'
import { getDashboardSeries, getLiveMetrics } from '@/features/admin/dashboard-queries'
import { DashboardLive } from '@/features/admin/DashboardLive'
import { TrendChart } from '@/shared/ui/TrendChart'
import { getModerationCounts } from '@/features/moderation/queries'
import { getReportsCounts } from '@/features/reports/queries'
import { getFeedbackCounts } from '@/features/feedback/queries'

export const metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic' // всегда свежие числа, без ISR-кэша

function num(n: number): string {
  return new Intl.NumberFormat('en').format(n)
}
function mmdd(iso: string): string {
  return iso.slice(5)
}

export default async function AdminDashboardPage() {
  await requireAdmin()
  const lang = await getLang()
  const [initial, series, mod, reports, feedback] = await Promise.all([
    getLiveMetrics(),
    getDashboardSeries(14),
    getModerationCounts(),
    getReportsCounts(),
    getFeedbackCounts(),
  ])

  const xLabels: [string, string] = [mmdd(series.days[0]), mmdd(series.days[series.days.length - 1])]
  const spendTotal = series.spend.reduce((s, v) => s + v, 0)
  const charts = [
    { title: tr({ en: 'Spend / day', ru: 'Расход / день' }, lang), points: series.spend, color: 'accent' as const, total: '$' + spendTotal.toFixed(2) },
    { title: tr({ en: 'Generations / day', ru: 'Генерации / день' }, lang), points: series.generations, color: 'ok' as const, total: num(series.generations.reduce((s, v) => s + v, 0)) },
    { title: tr({ en: 'New lists / day', ru: 'Новые списки / день' }, lang), points: series.newLists, color: 'cur' as const, total: num(series.newLists.reduce((s, v) => s + v, 0)) },
    { title: tr({ en: 'New users / day', ru: 'Новые юзеры / день' }, lang), points: series.signups, color: 'warn' as const, total: num(series.signups.reduce((s, v) => s + v, 0)) },
  ]

  const inbox = [
    { label: tr({ en: 'Moderation', ru: 'Модерация' }, lang), value: mod.pending, href: '/admin/moderation' },
    { label: tr({ en: 'Reports', ru: 'Жалобы' }, lang), value: reports.new, href: '/admin/reports' },
    { label: tr({ en: 'Feedback', ru: 'Фидбек' }, lang), value: feedback.new, href: '/admin/feedback' },
  ]

  return (
    <div className="flex w-full min-w-0 flex-col gap-6 px-5 py-6 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold text-ink">{tr({ en: 'Dashboard', ru: 'Дашборд' }, lang)}</h1>
          <p className="text-[13px] text-ink-2">
            {tr({ en: 'Live monitoring — traffic, generations, spend, queue.', ru: 'Живой мониторинг — трафик, генерации, расход, очередь.' }, lang)}
          </p>
        </div>
        <Link href="/admin/usage" className="text-[13px] text-accent hover:underline">
          {tr({ en: 'Detailed usage →', ru: 'Подробный расход →' }, lang)}
        </Link>
      </div>

      {/* Живые плитки «Сейчас» + «Сегодня» (клиентский поллинг) */}
      <DashboardLive initial={initial} lang={lang} />

      {/* Тренды за 14 дней */}
      <div className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-2">
          {tr({ en: 'Trends · 14 days', ru: 'Тренды · 14 дней' }, lang)}
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {charts.map((c) => (
            <div key={c.title} className="rounded-lg border border-border bg-surface p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[12.5px] font-medium text-ink-2">{c.title}</span>
                <span className="font-mono text-[13px] font-semibold text-ink">{c.total}</span>
              </div>
              <TrendChart points={c.points} color={c.color} labels={xLabels} height={90} />
            </div>
          ))}
        </div>
      </div>

      {/* Инбокс — очереди, требующие действия */}
      <div className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-2">{tr({ en: 'Inbox', ru: 'Требует внимания' }, lang)}</h2>
        <div className="grid grid-cols-3 gap-3">
          {inbox.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className="rounded-lg border border-border bg-surface p-4 hover:border-border-strong"
            >
              <div className="text-[11px] uppercase tracking-wide text-muted">{i.label}</div>
              <div className={`mt-1 text-[22px] font-bold tabular-nums ${i.value > 0 ? 'text-(--accent)' : 'text-ink'}`}>{num(i.value)}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
