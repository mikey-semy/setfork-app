import Link from 'next/link'
import { GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { Badge } from '@/shared/ui/badge'
import { Tooltip } from '@/shared/ui/Tooltip'
import { DiffStat } from '@/shared/ui/DiffStat'
import { SuggestionTitle } from '@/features/library/SuggestionTitle'
import { branchLabel } from '@/features/git/branch-label'
import type { loadSuggestionPage } from './load'

type Loaded = Awaited<ReturnType<typeof loadSuggestionPage>>

/** Сколько аватаров соавторов показываем; остальные — числом. */
const COAUTHORS_SHOWN = 3

/**
 * Шапка предложения: заголовок-сообщение, статус, объём правки и строка «кто, когда,
 * откуда куда». Меняется вместе с тем, что мы считаем важным сказать о правке до того,
 * как человек открыл вкладки.
 */
export function SuggestionHeader({
  owner,
  slug,
  lang,
  viewerId,
  data,
}: {
  owner: string
  slug: string
  lang: Lang
  viewerId?: string
  data: Loaded
}) {
  const { sug, meta, path, summary, coauthors, statusVariant, statusLabel, isDraft, fmt } = data
  return (
    <>
      {/* Шапка PR: сообщение правки как заголовок + номер #N. Номер — адрес для
          людей: /suggestions/12 работает наравне с uuid (getSuggestion берёт оба). */}
      <SuggestionTitle
        note={sug.note || t('noCommitMessage', lang)}
        number={sug.number}
        path={path}
        suggestionId={sug.id}
        canEdit={!!viewerId && (viewerId === sug.authorId || viewerId === meta.ownerId)}
        labels={{
          edit: t('cmEdit', lang),
          save: t('cmSave', lang),
          cancel: t('commentCancel', lang),
          placeholder: t('prTitlePlaceholder', lang),
        }}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Крупнее рядового чипа (это главный статус страницы), но той же тихой палитры. */}
        <Badge variant={statusVariant} className="px-3 py-1 text-[0.78125rem]">
          <StatusIcon status={sug.status} isDraft={isDraft} /> {statusLabel}
        </Badge>
        {/* Объём правки в шапке — тот же индикатор, что в диффе и в коммитах. */}
        <DiffStat counts={summary} squares />
        <span className="text-[0.8125rem] text-ink-2">
          {t('proposedBy', lang)}{' '}
          <Link href={`/${sug.author.handle}`} className="font-semibold text-ink hover:text-accent">
            {sug.author.handle}
          </Link>
          {/* Соавторы: над правкой работают несколько человек, и «предложил X»
              в одиночку это скрывало. У ветки вклад берём из авторства коммитов,
              у старых предложений — из тех, кто правил пункты. */}
          {coauthors.length > 0 && (
            <>
              {' '}
              <Tooltip label={`${t('prCoauthors', lang)}: ${coauthors.map((c) => c.handle).join(', ')}`}>
                <span className="inline-flex shrink-0 items-center gap-0.5 align-middle">
                  {coauthors.slice(0, COAUTHORS_SHOWN).map((c) => (
                    <Avatar key={c.handle} handle={c.handle} avatarUrl={c.avatarUrl} size={18} />
                  ))}
                  {coauthors.length > COAUTHORS_SHOWN && (
                    <span className="font-mono text-[0.6875rem] text-muted">+{coauthors.length - COAUTHORS_SHOWN}</span>
                  )}
                </span>
              </Tooltip>
            </>
          )}{' '}
          · {fmt.format(new Date(sug.createdAt))} ·{' '}
          {sug.branchRef ? (
            <>
              <Link
                href={`/${owner}/${slug}?ref=${encodeURIComponent(sug.branchRef)}`}
                className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[0.78125rem] text-ink hover:text-accent"
              >
                <GitBranch size={11} /> {branchLabel(sug.branchRef, lang)}
              </Link>{' '}
              →{' '}
              <Tooltip label={t('defaultBranchHint', lang)}>
                <span className="font-mono text-[0.78125rem]">main</span>
              </Tooltip>
            </>
          ) : (
            <>{t('pr.basedOnV', lang).replace('{v}', String(sug.baseVersion))}</>
          )}
        </span>
      </div>
    </>
  )
}

/** Значок статуса: принято, закрыто, черновик или открыто. */
function StatusIcon({ status, isDraft }: { status: string; isDraft: boolean }) {
  if (status === 'accepted') return <GitMerge size={14} />
  if (status === 'rejected') return <GitPullRequestClosed size={14} />
  return isDraft ? <GitPullRequestDraft size={14} /> : <GitPullRequest size={14} />
}
