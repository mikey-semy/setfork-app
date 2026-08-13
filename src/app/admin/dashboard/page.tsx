import Link from 'next/link'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { getDashboardSeries, getLiveMetrics } from '@/features/admin/dashboard-queries'
import { DashboardLive } from '@/features/admin/DashboardLive'
import { PageHeader } from '@/shared/ui/PageHeader'
import { StatTile } from '@/shared/ui/StatTile'
import { TrendChart } from '@/shared/ui/TrendChart'
import { getModerationCounts } from '@/features/moderation/queries'
import { getReportsCounts } from '@/features/reports/queries'
import { getFeedbackCounts } from '@/features/feedback/queries'
import { cardClass } from '@/shared/ui/card-style'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('dashboard', lang) }
}
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
    { title: t('admin.spendDay', lang), points: series.spend, color: 'accent' as const, total: '$' + spendTotal.toFixed(2) },
    { title: t('admin.generationsDay', lang), points: series.generations, color: 'ok' as const, total: num(series.generations.reduce((s, v) => s + v, 0)) },
    { title: t('admin.newListsDay', lang), points: series.newLists, color: 'cur' as const, total: num(series.newLists.reduce((s, v) => s + v, 0)) },
    { title: t('admin.newUsersDay', lang), points: series.signups, color: 'warn' as const, total: num(series.signups.reduce((s, v) => s + v, 0)) },
  ]

  const inbox = [
    { label: t('admin.moderation', lang), value: mod.pending, href: '/admin/moderation' },
    { label: t('admin.reports', lang), value: reports.new, href: '/admin/reports' },
    { label: t('admin.feedback', lang), value: feedback.new, href: '/admin/feedback' },
  ]

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <PageHeader
        title={t('admin.dashboard', lang)}
        subtitle={t('admin.liveMonitoringTrafficGenerations', lang)}
        actions={
          <Link href="/admin/usage" className="text-[0.8125rem] text-accent hover:underline">
            {t('admin.detailedUsage', lang)}
          </Link>
        }
      />

      {/* Живые плитки «Сейчас» + «Сегодня» (клиентский поллинг) */}
      <DashboardLive initial={initial} lang={lang} />

      {/* Тренды за 14 дней */}
      <div className="flex flex-col gap-3">
        <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wide text-ink-2">
          {t('admin.trends14Days', lang)}
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {charts.map((c) => (
            <div key={c.title} className={cardClass()}>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[0.78125rem] font-medium text-ink-2">{c.title}</span>
                <span className="font-mono text-[0.8125rem] font-semibold text-ink">{c.total}</span>
              </div>
              <TrendChart points={c.points} color={c.color} labels={xLabels} height={90} />
            </div>
          ))}
        </div>
      </div>

      {/* Инбокс — очереди, требующие действия */}
      <div className="flex flex-col gap-3">
        <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wide text-ink-2">{t('admin.inbox', lang)}</h2>
        <div className="grid grid-cols-3 gap-3">
          {inbox.map((i) => (
            <StatTile key={i.href} href={i.href} label={i.label} value={num(i.value)} tone={i.value > 0 ? 'accent' : 'ink'} />
          ))}
        </div>
      </div>
    </div>
  )
}
