import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CircleCheck, CircleDot, MessageSquare, Milestone as MilestoneIcon, Plus } from 'lucide-react'
import { IssuesSearch } from '@/features/issues/IssuesSearch'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { getListMeta } from '@/features/library/queries'
import { ListHeader } from '@/features/library/ListHeader'
import { getIssueAssigneesFor, getIssueCounts, getIssueLabelsInUse, getIssues, getListLabels, type IssueFilter, type IssueSort } from '@/features/issues/queries'
import { IssueLabelChips } from '@/features/issues/IssueLabelChips'
import { LabelsManager } from '@/features/issues/LabelsManager'
import { FilterMenu } from '@/features/issues/FilterMenu'
import { resolveChip } from '@/features/issues/labels'
import { isCollaborator } from '@/features/collab/queries'
import { getMilestonesForPicker } from '@/features/milestones/queries'
import { Tag } from 'lucide-react'

export default async function IssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ status?: string; q?: string; label?: string; milestone?: string; sort?: string }>
}) {
  const { handle: owner, slug } = await params
  const sp = await searchParams
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const meta = await getListMeta(owner, slug)
  if (!meta) notFound()

  const status: IssueFilter = sp.status === 'closed' ? 'closed' : 'open'
  const q = sp.q?.trim() || undefined
  const label = sp.label || undefined
  const milestone = sp.milestone || undefined
  const sort: IssueSort = sp.sort === 'oldest' ? 'oldest' : 'newest'

  const [counts, list, labels, mstones, custom] = await Promise.all([
    getIssueCounts(meta.id),
    getIssues(meta.id, { status, q, label, milestone, sort }),
    getIssueLabelsInUse(meta.id),
    getMilestonesForPicker(meta.id),
    getListLabels(meta.id),
  ])
  const assigneesByIssue = await getIssueAssigneesFor(list.map((i) => i.id))
  const canManage = !!session && (session.userId === meta.ownerId || (await isCollaborator(meta.id, session.userId)))
  const base = `/${owner}/${slug}/issues`
  const fmt = new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', { day: 'numeric', month: 'short' })

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
      <ListHeader owner={owner} slug={slug} active="issues" />
      <div className="mx-auto w-full max-w-[900px] px-4 py-6">
        {/* Поиск + New */}
        <div className="mb-3 flex items-center gap-2">
          <form action={base} method="get" className="flex-1">
            {status === 'closed' && <input type="hidden" name="status" value="closed" />}
            {label && <input type="hidden" name="label" value={label} />}
            {sort === 'oldest' && <input type="hidden" name="sort" value="oldest" />}
            <IssuesSearch initial={q ?? ''} placeholder={t('searchIssuesPh', lang)} />
          </form>
          {session && (
            <Link href={`${base}/new`} className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-fg">
              <Plus size={15} /> {t('newIssue', lang)}
            </Link>
          )}
        </div>

        {/* Табы статуса + фильтры */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
          <div className="flex items-center gap-4 text-[13.5px] font-semibold">
            <Link href={hrefWith({ status: undefined })} className={`inline-flex items-center gap-1.5 ${status === 'open' ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}>
              <CircleDot size={15} /> {counts.open} {t('openLabel', lang)}
            </Link>
            <Link href={hrefWith({ status: 'closed' })} className={`inline-flex items-center gap-1.5 ${status === 'closed' ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}>
              <CircleCheck size={15} /> {counts.closed} {t('closedLabel', lang)}
            </Link>
          </div>
          <div className="flex items-center gap-1">
            <Link href={`/${owner}/${slug}/milestones`} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-surface hover:text-ink">
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
            <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-[13px] font-medium text-ink-2 hover:text-ink">
              <Tag size={14} /> {lang === 'ru' ? 'Кастомные метки' : 'Custom labels'}
              <span className="font-mono text-[11px] text-muted">{custom.length}</span>
            </summary>
            <div className="border-t border-border p-3">
              <LabelsManager templateId={meta.id} initial={custom} lang={lang} />
            </div>
          </details>
        )}

        {list.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-[13.5px] text-muted">
            {filtered ? t('noIssuesMatch', lang) : status === 'open' ? t('noOpenIssues', lang) : t('noClosedIssues', lang)}
          </div>
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
                    <Link href={`${base}/${it.number}`} className="text-[14.5px] font-semibold text-ink hover:text-accent">
                      {it.title}
                    </Link>
                    <IssueLabelChips labels={it.labels} lang={lang} custom={custom} />
                    {it.milestoneTitle && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11.5px] text-ink-2">
                        <MilestoneIcon size={11} className="text-accent" /> {it.milestoneTitle}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    #{it.number} · {t('openedThis', lang)} {it.authorHandle} · {fmt.format(new Date(it.createdAt))}
                  </div>
                </div>
                {(assigneesByIssue[it.id] ?? []).length > 0 && (
                  <div className="mt-0.5 flex -space-x-1.5">
                    {(assigneesByIssue[it.id] ?? []).slice(0, 3).map((a) => (
                      <span key={a.handle} title={a.handle} className="ring-2 ring-surface">
                        <Avatar handle={a.handle} avatarUrl={a.avatarUrl} size={18} />
                      </span>
                    ))}
                  </div>
                )}
                {it.commentCount > 0 && (
                  <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-muted">
                    <MessageSquare size={13} /> {it.commentCount}
                  </span>
                )}
                <Avatar handle={it.authorHandle} avatarUrl={it.authorAvatarUrl} size={20} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
