import Link from 'next/link'
import { ListChecks } from 'lucide-react'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr, type Lang } from '@/shared/i18n'
import { timeAgo } from '@/shared/ui/timeAgo'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { countUserRunsByStatus, getUserRuns, type RunStatus, type UserRunRow } from '@/features/runs/queries'
import { TabItem, TabNav } from '@/shared/ui/TabNav'
import { Pagination } from '@/shared/ui/Pagination'
import { pageCount, pageFromParam, pageHref, pageWindow } from '@/shared/lib/paging'
import { DeleteRunButton } from '@/features/runs/DeleteRunButton'
import { PAGE } from '@/shared/ui/control'
import { buttonClass } from '@/shared/ui/button-style'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('runs', lang) }
}

const TABS: { key: RunStatus; label: 'runsInProgress' | 'runsCompleted' | 'runsAbandoned' }[] = [
  { key: 'active', label: 'runsInProgress' },
  { key: 'done', label: 'runsCompleted' },
  { key: 'abandoned', label: 'runsAbandoned' },
]

/**
 * СТАТУС СТАЛ ВКЛАДКОЙ, а не разделом на общей странице.
 *
 * Раньше страница показывала три раздела сразу и делила ПОЛНУЮ выдачу в памяти — то есть
 * поднимала все прогоны человека, сколько бы их ни было. Со страницами такое деление
 * невозможно в принципе: страница могла бы состоять из одних завершённых, и раздел
 * «в процессе» выглядел бы пустым при живых прогонах.
 *
 * Вкладки — та же форма, что у задач и правок: отбор в запросе, счётчики рядом с
 * названием, страницы внутри вкладки.
 */
export default async function MyRunsPage({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string }> }) {
  const session = await requireSession()
  const sp = await searchParams
  const tab: RunStatus = TABS.find((x) => x.key === sp.tab)?.key ?? 'active'
  const [lang, counts] = await Promise.all([getLang(), countUserRunsByStatus(session.userId)])
  const totalPages = pageCount(counts[tab])
  const page = pageFromParam(sp.page, totalPages)
  const rows = await getUserRuns(session.userId, tab, pageWindow(page))
  const empty = counts.active + counts.done + counts.abandoned === 0

  return (
    <div className={PAGE}>
      {/* Видимой шапки нет: тот же заголовок уже стоит в TopNav (см. /my-lists).
          Здесь он остаётся только для скринридеров и структуры страницы. */}
      <PageHeader hideTitle title={t('myRuns', lang)} />

      {empty ? (
        <EmptyState icon={<ListChecks size={34} strokeWidth={1.5} />} title={t('noRunsYet', lang)} />
      ) : (
        <>
          {/* ОДИН ТАБ-БАР НА САЙТ — тот же `TabNav`, что у профиля, модерации и Explore.
              Первая версия этого ряда была рукописной, и это ровно та ошибка, с которой
              начиналась вся работа по листанию: шесть своих листалок вместо одной. У
              вкладок она уже была решена примитивом, и заводить седьмой ряд незачем.

              Форма совпадает с модерацией построчно: отбор внутри страницы через параметр
              адреса, счётчик рядом с подписью. Ряд не листается вбок, а не влезшие вкладки
              уезжают в «…» — на узком экране видно, что вкладок больше. */}
          <div className="-mx-4 mb-4">
            <TabNav scope="runs" overflow={{ moreLabel: t('moreTabs', lang) }}>
              {TABS.map((x) => (
                <TabItem
                  key={x.key}
                  href={x.key === 'active' ? '/runs' : `/runs?tab=${x.key}`}
                  on={x.key === tab}
                  label={t(x.label, lang)}
                  count={counts[x.key]}
                />
              ))}
            </TabNav>
          </div>

          {rows.length === 0 ? (
            // НЕ «пока нет прогонов»: сюда попадают, когда пуста ИМЕННО эта вкладка, а
            // прогоны у человека есть — просто в другой. Прежний текст был бы ложью,
            // причём той, что заставляет искать несуществующую поломку.
            <EmptyState variant="plain" hint={t('noRunsInTab', lang)} />
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map((r) => (
                <RunCard key={r.id} r={r} lang={lang} muted={tab === 'abandoned'} />
              ))}
            </div>
          )}

          <Pagination page={page} totalPages={totalPages} makeHref={pageHref('/runs', sp)} lang={lang} />
        </>
      )}
    </div>
  )
}

function RunCard({ r, lang, muted }: { r: UserRunRow; lang: Lang; muted?: boolean }) {
  const pct = r.total > 0 ? Math.round((r.doneCount / r.total) * 100) : 0
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong ${muted ? 'opacity-70' : ''}`}
    >
      <Link href={`/runs/${r.id}`} className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-body-lg font-semibold text-ink">{tr(r.title, lang)}</span>
          <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-caption text-ink-2">v{r.version}</span>
          {r.status === 'failed' && <span className="rounded-md border border-danger/40 px-1.5 py-0.5 text-caption font-medium text-danger">{t('runFailed', lang)}</span>}
        </div>
        <div className="mt-0.5 truncate text-body-sm text-muted">
          {r.handle}/{r.slug} · {timeAgo(r.updatedAt, lang)}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-ok transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 font-mono text-caption text-ink-2">
            {r.doneCount}/{r.total}
          </span>
        </div>
      </Link>
      <Link
        href={`/runs/${r.id}`}
        className={buttonClass()}
      >
        {r.status === 'active' ? t('runResume', lang) : t('runOpen', lang)}
      </Link>
      <DeleteRunButton runId={r.id} confirmText={t('runDeleteConfirm', lang)} label={t('runDelete', lang)} lang={lang} />
    </div>
  )
}
