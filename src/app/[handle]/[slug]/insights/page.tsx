import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Bell, Eye, GitFork, MousePointerClick, PlayCircle, Star, Tag, Users } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Badge } from '@/shared/ui/badge'
import { UserLine } from '@/shared/ui/UserLine'
import { TrendChart } from '@/shared/ui/TrendChart'
import { getContributors } from '@/features/library/queries'
import { requireViewableMeta } from '@/features/library/guard'
import { headers } from 'next/headers'
import { getInsightTotals, getWeeklySeries, WEEKS } from '@/features/insights/queries'
import { BadgesCard } from '@/features/badges/BadgesCard'
import { PAGE } from '@/shared/ui/control'
import { appOrigin } from '@/shared/auth/app-origin'
import { isPubliclyVisible } from '@/core'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('insightsTab', lang)} · ${handle}/${slug}` }
}

const card = 'rounded-lg border border-border bg-surface p-4'

export default async function InsightsPage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle: owner, slug }, lang] = await Promise.all([params, getLang()])
  const ru = lang === 'ru'
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const origin = appOrigin()
  const [series, totals, contributors] = await Promise.all([
    getWeeklySeries(meta.id),
    getInsightTotals(meta.id),
    getContributors(meta.id, meta.ownerId),
  ])
  const fmt = new Intl.DateTimeFormat(ru ? 'ru' : 'en', { month: 'short', day: 'numeric' })
  const range: [string, string] = [fmt.format(new Date(series.weeks[0])), fmt.format(new Date(series.weeks.at(-1)!))]

  const stats = [
    { icon: Eye, label: ru ? 'Просмотры' : 'Views', v: totals.views },
    { icon: MousePointerClick, label: ru ? 'Клики' : 'Link clicks', v: totals.clicks },
    { icon: Star, label: ru ? 'Звёзды' : 'Stars', v: totals.stars },
    { icon: GitFork, label: ru ? 'Форки' : 'Forks', v: totals.forks },
    { icon: PlayCircle, label: ru ? 'Прогоны' : 'Runs', v: totals.runs },
    { icon: Bell, label: ru ? 'Наблюдатели' : 'Watchers', v: totals.watchers },
    { icon: Tag, label: ru ? 'Версии' : 'Versions', v: totals.versions },
  ]

  const charts = [
    { key: 'views', title: ru ? 'Просмотры по неделям' : 'Views per week', points: series.views, color: 'accent' as const },
    { key: 'clicks', title: ru ? 'Клики по ссылкам по неделям' : 'Link clicks per week', points: series.clicks, color: 'ok' as const },
    { key: 'stars', title: ru ? 'Звёзды по неделям' : 'Stars per week', points: series.stars, color: 'accent' as const },
    { key: 'runs', title: ru ? 'Прогоны по неделям' : 'Runs per week', points: series.runs, color: 'ok' as const },
    { key: 'forks', title: ru ? 'Форки по неделям' : 'Forks per week', points: series.forks, color: 'warn' as const },
    { key: 'versions', title: ru ? 'Версии по неделям' : 'Versions per week', points: series.versions, color: 'cur' as const },
  ]

  return (
    <>
      <div className={PAGE}>
        {/* Итоги */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {stats.map(({ icon: Icon, label, v }) => (
            <div key={label} className={card}>
              <div className="flex items-center gap-1.5 text-caption uppercase tracking-wide text-muted">
                <Icon size={12} /> {label}
              </div>
              <div className="mt-1 text-heading font-bold tabular-nums text-ink">{v}</div>
            </div>
          ))}
        </div>

        {/* grid-cols-1 на базе ОБЯЗАТЕЛЕН: без явной колонки на мобиле сетка берёт
            неявный трек `auto`, который тянется к max-content графика (600px) и уезжает
            за экран. `grid-cols-1` = minmax(0,1fr) — колонка сжимается до ширины экрана. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* Графики за 12 недель */}
          <div className="grid grid-cols-1 min-w-0 gap-4 sm:grid-cols-2">
            {charts.map((c) => (
              <div key={c.key} className={`${card} min-w-0`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-body font-semibold text-ink">{c.title}</span>
                  <span className="shrink-0 whitespace-nowrap font-mono text-caption text-muted">
                    {c.points.reduce((s, v) => s + v, 0)} / {WEEKS}{ru ? ' нед' : 'w'}
                  </span>
                </div>
                <TrendChart points={c.points} color={c.color} labels={range} />
              </div>
            ))}
          </div>

          {/* Справа: трафик прогонов + контрибьюторы */}
          <aside className="flex flex-col gap-4">
            <div className={card}>
              <div className="mb-2 text-body font-semibold text-ink">{ru ? 'Трафик прогонов' : 'Run traffic'}</div>
              <dl className="flex flex-col gap-1.5 text-body">
                <div className="flex justify-between">
                  <dt className="text-ink-2">{ru ? 'Всего прогонов' : 'Total runs'}</dt>
                  <dd className="font-mono tabular-nums text-ink">{totals.runs}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-2">{ru ? 'Уникальных людей' : 'Unique runners'}</dt>
                  <dd className="font-mono tabular-nums text-ink">{totals.uniqueRunners}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-2">{ru ? 'Завершено' : 'Completed'}</dt>
                  <dd className="font-mono tabular-nums text-ink">
                    {totals.runsDone}
                    {totals.runs > 0 && (
                      <span className="ml-1 text-muted">({Math.round((totals.runsDone / totals.runs) * 100)}%)</span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            <div className={card}>
              <div className="mb-2 flex items-center gap-1.5 text-body font-semibold text-ink">
                <Users size={13} className="text-muted" /> {ru ? 'Контрибьюторы' : 'Contributors'}
              </div>
              <div className="flex flex-col gap-1">
                {contributors.map((c) => (
                  <div key={c.handle} className="flex items-center gap-2 rounded-md px-1.5 py-1">
                    <UserLine handle={c.handle} avatarUrl={c.avatarUrl} size="md" className="min-w-0" />
                    {c.accepted === Infinity ? (
                      <Badge className="ml-auto">{ru ? 'владелец' : 'owner'}</Badge>
                    ) : (
                      <span className="ml-auto font-mono text-caption text-muted">
                        {c.accepted} {ru ? 'принято' : 'accepted'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {isPubliclyVisible(meta) && <BadgesCard owner={owner} slug={slug} origin={origin} lang={lang} />}
          </aside>
        </div>
      </div>
    </>
  )
}
