import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
  Milestone as MilestoneIcon,
  Plus,
} from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, type Lang } from '@/shared/i18n'
import { branchLabel } from '@/features/git/branch-label'
import { Avatar } from '@/shared/ui/Avatar'
import { EmptyState } from '@/shared/ui/EmptyState'
import { FilterMenu } from '@/shared/ui/FilterMenu'
import { LabelChips } from '@/shared/ui/LabelChips'
import { SearchForm } from '@/shared/ui/SearchForm'
import { Tooltip } from '@/shared/ui/Tooltip'
import { requireViewableMeta } from '@/features/library/guard'
import { isCollaborator } from '@/features/collab/queries'
import { SuggestionCheckbox, SuggestionSelection } from '@/features/library/SuggestionSelection'
import {
  countSuggestions,
  getSuggestionAuthors,
  getSuggestionCounts,
  getSuggestionLabelsInUse,
  getSuggestions,
  getSuggestionsAssignees,
  type SuggestionFilter,
  type SuggestionSort,
} from '@/features/library/queries'
import { getListLabels } from '@/features/issues/queries'
import { Pagination } from '@/shared/ui/Pagination'
import { pageCount, pageFromParam, pageHref, pageWindow } from '@/shared/lib/paging'
import { getMilestonesForPicker } from '@/features/milestones/queries'
import { resolveChip } from '@/shared/lib/labels'
import { PAGE } from '@/shared/ui/control'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('suggestions', lang)} · ${handle}/${slug}` }
}

/**
 * Иконка состояния — как у GitHub в списке PR: открытое, черновик, слитое и
 * закрытое различаются ЗНАЧКОМ, а не только цветом подписи. На узком экране
 * подпись прячется, и значок остаётся единственным носителем состояния.
 */
function StatusIcon({ status, draft, lang }: { status: string; draft: boolean; lang: Lang }) {
  const [Icon, cls, label] =
    status === 'accepted'
      ? [GitMerge, 'text-ok', t('statusAccepted', lang)]
      : status === 'rejected'
        ? [GitPullRequestClosed, 'text-muted', t('statusRejected', lang)]
        : draft
          ? [GitPullRequestDraft, 'text-muted', t('prDraft', lang)]
          : [GitPullRequest, 'text-accent', t('statusOpen', lang)]
  return (
    <Tooltip label={label}>
      <span className={`mt-0.5 shrink-0 ${cls}`} aria-label={label}>
        <Icon size={16} />
      </span>
    </Tooltip>
  )
}

export default async function SuggestionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ status?: string; q?: string; label?: string; milestone?: string; author?: string; sort?: string; page?: string }>
}) {
  const [{ handle: owner, slug }, sp, lang, session] = await Promise.all([params, searchParams, getLang(), getSession()])
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()

  const status: SuggestionFilter = sp.status === 'closed' ? 'closed' : 'open'
  const q = sp.q?.trim() || undefined
  const label = sp.label || undefined
  const milestone = sp.milestone || undefined
  const author = sp.author || undefined
  const sort: SuggestionSort = sp.sort === 'oldest' ? 'oldest' : 'newest'
  const base = `/${owner}/${slug}/suggestions`

  // Счёт идёт по ТОМУ ЖЕ отбору, что и выдача (countSuggestions делит с ней условия),
  // иначе листалка нарисовала бы страницы, которых нет.
  const query = { status, q, label, milestone, author, sort }
  const total = await countSuggestions(meta.id, query)
  const totalPages = pageCount(total)
  const page = pageFromParam(sp.page, totalPages)
  const [counts, list, labels, mstones, custom, authors] = await Promise.all([
    getSuggestionCounts(meta.id),
    getSuggestions(meta.id, query, pageWindow(page)),
    getSuggestionLabelsInUse(meta.id),
    getMilestonesForPicker(meta.id),
    getListLabels(meta.id),
    getSuggestionAuthors(meta.id),
  ])
  const assignees = await getSuggestionsAssignees(list.map((s) => s.id))
  // Пакетные действия — тем же, кто ведёт предложения поодиночке.
  const canManage =
    !!session && (session.userId === meta.ownerId || (await isCollaborator(meta.id, session.userId)))
  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' })

  // href с текущими параметрами + перекрытием (undefined убирает параметр) —
  // тот же приём, что в списке задач: фильтры комбинируются, а не сбрасывают друг друга.
  const hrefWith = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const merged: Record<string, string | undefined> = {
      status: status === 'open' ? undefined : status,
      q,
      label,
      milestone,
      author,
      sort: sort === 'newest' ? undefined : sort,
      ...over,
    }
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v)
    const s = p.toString()
    return s ? `${base}?${s}` : base
  }
  const filtered = !!(q || label || milestone || author)

  return (
    <div className={PAGE}>
      {/* Поиск + «Предложить правку». Ряд одной высоты, кнопка не переносится. */}
      <div className="mb-3 flex items-center gap-2">
        <form action={base} method="get" className="min-w-0 flex-1">
          {status === 'closed' && <input type="hidden" name="status" value="closed" />}
          {label && <input type="hidden" name="label" value={label} />}
          {author && <input type="hidden" name="author" value={author} />}
          {sort === 'oldest' && <input type="hidden" name="sort" value="oldest" />}
          <SearchForm initial={q ?? ''} placeholder={t('prSearchPh', lang)} />
        </form>
        {session && (
          <Link
            href={`/${owner}/${slug}/suggest`}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-[0.78125rem] font-semibold text-primary-fg hover:opacity-90"
          >
            {/* На мобиле — только значок: длинным подписям в кнопках там не место. */}
            <Plus size={15} /> <span className="max-sm:hidden">{t('suggestEdit', lang)}</span>
          </Link>
        )}
      </div>

      {/* Вкладки состояния + фильтры. Фильтры уезжают в дропдауны, поэтому ряд
          не расползается на узком экране. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
        <div className="flex items-center gap-4 text-[0.8125rem] font-semibold">
          <Link href={hrefWith({ status: undefined })} className={`inline-flex items-center gap-1.5 ${status === 'open' ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}>
            <GitPullRequest size={15} /> {counts.open} <span className="max-sm:hidden">{t('openLabel', lang)}</span>
          </Link>
          <Link href={hrefWith({ status: 'closed' })} className={`inline-flex items-center gap-1.5 ${status === 'closed' ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}>
            <GitMerge size={15} /> {counts.closed} <span className="max-sm:hidden">{t('closedLabel', lang)}</span>
          </Link>
        </div>
        <div className="flex items-center gap-1">
          {authors.length > 1 && (
            <FilterMenu
              label={t('prAuthorFilter', lang)}
              items={[
                { label: t('prAllAuthors', lang), href: hrefWith({ author: undefined }), active: !author },
                ...authors.map((a) => ({ label: a.handle, href: hrefWith({ author: a.handle }), active: author === a.handle })),
              ]}
            />
          )}
          {labels.length > 0 && (
            <FilterMenu
              label={t('labelsLabel', lang)}
              items={[
                { label: t('allLabels', lang), href: hrefWith({ label: undefined }), active: !label },
                ...labels.map((l) => ({ label: resolveChip(l, custom, lang).text, href: hrefWith({ label: l }), active: label === l })),
              ]}
            />
          )}
          {mstones.length > 0 && (
            <FilterMenu
              label={t('milestoneLabel', lang)}
              items={[
                { label: t('allMilestones', lang), href: hrefWith({ milestone: undefined }), active: !milestone },
                ...mstones.map((m) => ({ label: m.title, href: hrefWith({ milestone: m.id }), active: milestone === m.id })),
              ]}
            />
          )}
          <FilterMenu
            label={t('sortLabel', lang)}
            items={[
              { label: t('sortNewest', lang), href: hrefWith({ sort: undefined }), active: sort === 'newest' },
              { label: t('sortOldest', lang), href: hrefWith({ sort: 'oldest' }), active: sort === 'oldest' },
            ]}
          />
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState
          title={filtered ? t('prNoneMatch', lang) : status === 'open' ? t('prNoneOpen', lang) : t('prNoneClosed', lang)}
        />
      ) : (
        <SuggestionSelection
          ids={list.map((s) => s.id)}
          canManage={canManage}
          custom={custom}
          milestones={mstones}
          lang={lang}
          labels={{
            selectAll: t('prSelectAll', lang),
            selected: t('prSelected', lang),
            clear: t('commentCancel', lang),
            label: t('labelsLabel', lang),
            milestone: t('milestoneLabel', lang),
            close: t('reject', lang),
          }}
        >
        <div className="divide-y divide-border rounded-lg border border-border bg-surface">
          {list.map((s) => (
            <div key={s.id} className="flex items-start gap-3 px-4 py-3">
              <SuggestionCheckbox id={s.id} />
              <StatusIcon status={s.status} draft={s.draft} lang={lang} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <Link
                    href={`${base}/${s.number ?? s.id}`}
                    className="min-w-0 text-[0.875rem] font-semibold text-ink hover:text-accent [overflow-wrap:anywhere]"
                  >
                    {s.note || t('noCommitMessage', lang)}
                  </Link>
                  <LabelChips labels={s.labels} lang={lang} custom={custom} />
                  {s.milestoneTitle && (
                    <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[0.6875rem] text-ink-2 [overflow-wrap:anywhere]">
                      <MilestoneIcon size={11} className="text-accent" /> {s.milestoneTitle}
                    </span>
                  )}
                </div>
                {/* Вторая строка — метаданные. Номер, автор, дата, объём. У ветки
                    вместо числа пунктов показываем саму ветку: пункты там лежат в
                    git, и «0 пунктов» было прямым враньём. */}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.78125rem] text-muted">
                  <span className="font-mono">#{s.number ?? '—'}</span>
                  <span>
                    {t('proposedBy', lang)} <span className="text-ink-2">{s.author.handle}</span>
                  </span>
                  <span>{fmt.format(new Date(s.createdAt))}</span>
                  {s.branchRef ? (
                    <span className="inline-flex min-w-0 items-center gap-1 font-mono">
                      <GitBranch size={11} className="shrink-0" />
                      <span className="truncate">{branchLabel(s.branchRef, lang)}</span>
                    </span>
                  ) : (
                    <span className="max-sm:hidden">
                      {lang === 'ru' ? `пунктов: ${s.itemCount ?? 0}` : `items: ${s.itemCount ?? 0}`} · v{s.baseVersion}
                    </span>
                  )}
                </div>
              </div>

              {/* Правый край строки: исполнители и счётчик обсуждения. */}
              <div className="flex shrink-0 items-center gap-2">
                <div className="flex -space-x-1">
                  {(assignees[s.id] ?? []).slice(0, 3).map((a) => (
                    <Tooltip key={a.handle} label={a.handle}>
                      <span className="inline-block rounded-full ring-2 ring-surface">
                        <Avatar handle={a.handle} avatarUrl={a.avatarUrl} size={18} />
                      </span>
                    </Tooltip>
                  ))}
                </div>
                {s.commentCount > 0 && (
                  <Link
                    href={`${base}/${s.number ?? s.id}`}
                    className="inline-flex items-center gap-1 font-mono text-[0.78125rem] text-muted hover:text-ink"
                  >
                    <MessageSquare size={13} /> {s.commentCount}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
        </SuggestionSelection>
      )}
      {/* Отбор переносится сам: pageHref тащит остальные параметры и меняет номер. */}
      <Pagination page={page} totalPages={totalPages} total={total} makeHref={pageHref(base, sp)} lang={lang} />
    </div>
  )
}
