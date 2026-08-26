import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CircleCheck, CircleDot, MessageSquare, Milestone as MilestoneIcon, Plus } from 'lucide-react'
import { SearchForm } from '@/shared/ui/SearchForm'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Tooltip } from '@/shared/ui/Tooltip'
import { requireViewableMeta } from '@/features/library/guard'
import { countListIssues, getIssueAssigneesFor, getIssueCounts, getIssueLabelsInUse, getIssues, getListLabels, type IssueFilter, type IssueSort } from '@/features/issues/queries'
import { Pagination } from '@/shared/ui/Pagination'
import { pageCount, pageFromParam, pageHref, pageWindow } from '@/shared/lib/paging'
import { LabelChips } from '@/shared/ui/LabelChips'
import { LabelsManager } from '@/features/issues/LabelsManager'
import { FilterMenu } from '@/shared/ui/FilterMenu'
import { resolveChip } from '@/shared/lib/labels'
import { isCollaborator } from '@/features/collab/queries'
import { getMilestonesForPicker } from '@/features/milestones/queries'
import { Tag } from 'lucide-react'
import { PAGE } from '@/shared/ui/control'
import { isFeatureEnabled } from '@/core'
import { buttonClass } from '@/shared/ui/button-style'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('issuesTab', lang)} · ${handle}/${slug}` }
}

export default async function IssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ status?: string; q?: string; label?: string; milestone?: string; sort?: string; page?: string }>
}) {
  const [{ handle: owner, slug }, sp, lang, session] = await Promise.all([params, searchParams, getLang(), getSession()])
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  // Тот же предикат, что у записи (canWriteToFeature): страница отражает решение
  // владельца, но не заменяет его — проверка живёт в actions.
  if (!isFeatureEnabled(meta, 'issues')) notFound() // раздел выключен (Settings → Features)

  const status: IssueFilter = sp.status === 'closed' ? 'closed' : 'open'
  const q = sp.q?.trim() || undefined
  const label = sp.label || undefined
  const milestone = sp.milestone || undefined
  const sort: IssueSort = sp.sort === 'oldest' ? 'oldest' : 'newest'

  // Номера страниц, а не курсор: задачи — каталог, по нему прыгают и его фильтруют.
  // Счёт идёт по ТОМУ ЖЕ отбору, что и выдача (countListIssues делит с ней условия), иначе
  // листалка нарисовала бы страницы, которых нет.
  const query = { status, q, label, milestone, sort }
  const total = await countListIssues(meta.id, query)
  const totalPages = pageCount(total)
  const page = pageFromParam(sp.page, totalPages)
  const [counts, list, labels, mstones, custom] = await Promise.all([
    getIssueCounts(meta.id),
    getIssues(meta.id, query, pageWindow(page)),
    getIssueLabelsInUse(meta.id),
    getMilestonesForPicker(meta.id),
    getListLabels(meta.id),
  ])
  const assigneesByIssue = await getIssueAssigneesFor(list.map((i) => i.id))
  const canManage = !!session && (session.userId === meta.ownerId || (await isCollaborator(meta.id, session.userId)))
  const base = `/${owner}/${slug}/issues`
  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' })

  // href с текущими параметрами + перекрытием (undefined убирает параметр).
  const hrefWith = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const merged: Record<string, string | undefined> = { status, q, label, milestone, sort: sort === 'newest' ? undefined : sort, ...over }
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v)
    const s = p.toString()
    return s ? `${base}?${s}` : base
  }

  const filtered = !!(q || label || milestone)

  return (
    <>
      <div className={PAGE}>
        {/* Поиск + New */}
        <div className="mb-3 flex items-center gap-2">
          <form action={base} method="get" className="flex-1">
            {status === 'closed' && <input type="hidden" name="status" value="closed" />}
            {label && <input type="hidden" name="label" value={label} />}
            {sort === 'oldest' && <input type="hidden" name="sort" value="oldest" />}
            <SearchForm initial={q ?? ''} placeholder={t('searchIssuesPh', lang)} />
          </form>
          {session && (
            <Tooltip label={t('newIssue', lang)}>
              <Link
                href={`${base}/new`}
                aria-label={t('newIssue', lang)}
                // `touch="grow"`, потому что рядом стоит ПОЛЕ ПОИСКА. Поле на грубом
                // указателе дорастает до 44px — иначе в него не влезает 16px шрифт,
                // который проект ставит против зума iOS, — а кнопка по умолчанию
                // остаётся 32 и добирает цель невидимой зоной. В ряду это читается как
                // разнобой высот. Ряд равняется по тому, кто не может стать ниже.
                className={buttonClass({ variant: 'primary', touch: 'grow' })}
              >
                <Plus size={15} />
                <span className="max-sm:hidden">{t('newIssue', lang)}</span>
              </Link>
            </Tooltip>
          )}
        </div>

        {/* Табы статуса + фильтры */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
          <div className="flex items-center gap-4 text-body font-semibold">
            <Link href={hrefWith({ status: undefined })} className={`inline-flex items-center gap-1.5 ${status === 'open' ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}>
              <CircleDot size={15} /> {counts.open} {t('openLabel', lang)}
            </Link>
            <Link href={hrefWith({ status: 'closed' })} className={`inline-flex items-center gap-1.5 ${status === 'closed' ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}>
              <CircleCheck size={15} /> {counts.closed} {t('closedLabel', lang)}
            </Link>
          </div>
          <div className="flex items-center gap-1">
            <Link href={`/${owner}/${slug}/milestones`} className={buttonClass({ variant: 'ghost', className: 'hover:bg-surface' })}>
              <MilestoneIcon size={14} /> {t('milestonesTitle', lang)}
            </Link>
            {labels.length > 0 && (
              <FilterMenu
                label={t('labelsLabel', lang)}
                items={[
                  { label: lang === 'ru' ? 'Все метки' : 'All labels', href: hrefWith({ label: undefined }), active: !label },
                  ...labels.map((l) => ({ label: resolveChip(l, custom, lang).text, href: hrefWith({ label: l }), active: label === l })),
                ]}
              />
            )}
            {mstones.length > 0 && (
              <FilterMenu
                label={t('milestoneLabel', lang)}
                items={[
                  { label: lang === 'ru' ? 'Все вехи' : 'All milestones', href: hrefWith({ milestone: undefined }), active: !milestone },
                  ...mstones.map((m) => ({ label: m.title, href: hrefWith({ milestone: m.id }), active: milestone === m.id })),
                ]}
              />
            )}
            <FilterMenu
              label={t('sortLabel', lang)}
              items={[
                { label: lang === 'ru' ? 'Сначала новые' : 'Newest', href: hrefWith({ sort: undefined }), active: sort === 'newest' },
                { label: lang === 'ru' ? 'Сначала старые' : 'Oldest', href: hrefWith({ sort: 'oldest' }), active: sort === 'oldest' },
              ]}
            />
          </div>
        </div>

        {/* Управление кастомными метками — владельцу/коллаборатору (свёрнуто). */}
        {canManage && (
          <details className="mb-3 rounded-md border border-border bg-surface">
            <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-body font-medium text-ink-2 hover:text-ink">
              <Tag size={14} /> {lang === 'ru' ? 'Кастомные метки' : 'Custom labels'}
              <span className="font-mono text-caption text-muted">{custom.length}</span>
            </summary>
            <div className="border-t border-border p-3">
              <LabelsManager templateId={meta.id} initial={custom} lang={lang} />
            </div>
          </details>
        )}

        {list.length === 0 ? (
          <EmptyState hint={filtered ? t('noIssuesMatch', lang) : status === 'open' ? t('noOpenIssues', lang) : t('noClosedIssues', lang)} />
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-surface">
            {list.map((it) => (
              <div key={it.id} className="flex items-start gap-3 px-4 py-3">
                {it.status === 'open' ? (
                  <CircleDot size={16} className="mt-0.5 shrink-0 text-ok" />
                ) : (
                  <CircleCheck size={16} className="mt-0.5 shrink-0 text-accent" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Заголовок пишет человек: одно длинное слово без пробелов иначе
                        распирает страницу на мобиле. Тот же приём, что в списке
                        предложений — там он уже стоял. */}
                    <Link href={`${base}/${it.number}`} className="min-w-0 text-body-lg font-semibold text-ink hover:text-accent [overflow-wrap:anywhere]">
                      {it.title}
                    </Link>
                    <LabelChips labels={it.labels} lang={lang} custom={custom} />
                    {it.milestoneTitle && (
                      <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-caption text-ink-2 [overflow-wrap:anywhere]">
                        <MilestoneIcon size={11} className="text-accent" /> {it.milestoneTitle}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-body-sm text-muted">
                    #{it.number} · {t('openedThis', lang)} {it.authorHandle} · {fmt.format(new Date(it.createdAt))}
                  </div>
                </div>
                {(assigneesByIssue[it.id] ?? []).length > 0 && (
                  <div className="mt-0.5 flex -space-x-1.5">
                    {(assigneesByIssue[it.id] ?? []).slice(0, 3).map((a) => (
                      <Tooltip key={a.handle} label={a.handle}>
                        <span className="ring-2 ring-surface">
                          <Avatar handle={a.handle} avatarUrl={a.avatarUrl} size={18} />
                        </span>
                      </Tooltip>
                    ))}
                  </div>
                )}
                {it.commentCount > 0 && (
                  <span className="mt-0.5 inline-flex items-center gap-1 text-body-sm text-muted">
                    <MessageSquare size={13} /> {it.commentCount}
                  </span>
                )}
                <Avatar handle={it.authorHandle} avatarUrl={it.authorAvatarUrl} size={20} />
              </div>
            ))}
          </div>
        )}
        {/* Отбор переносится сам: pageHref тащит остальные параметры и меняет номер. */}
        <Pagination page={page} totalPages={totalPages} total={total} makeHref={pageHref(base, sp)} lang={lang} />
      </div>
    </>
  )
}
