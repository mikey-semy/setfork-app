import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Check, GitBranch, GitMerge, GitPullRequest, X } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { Markdown } from '@/shared/ui/Markdown'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { MarkdownEditor } from '@/shared/ui/MarkdownEditor'
import { getSuggestion, getSuggestionComments, getVersionSteps } from '@/features/library/queries'
import { requireViewableMeta } from '@/features/library/guard'
import { acceptSuggestion, addSuggestionComment, mergeBranchPr, rejectSuggestion, resolveBranchPr } from '@/features/library/actions'
import { ConflictResolver } from '@/features/git/ConflictResolver'
import { threeWayMerge } from '@/features/git/three-way'
import { isCollaborator } from '@/features/collab/queries'
import { gitCore } from '@/features/git/core'
import { ListHeader } from '@/widgets/ListHeader'
import { SuggestionDiff } from '@/features/library/SuggestionDiff'
import { diffSteps } from '@/features/library/suggestion-diff'
import { getReactionsFor } from '@/features/reactions/queries'
import { Reactions } from '@/features/reactions/Reactions'
import { CommentCard } from '@/features/collab/CommentCard'
import type { ProposedItem } from '@/shared/db'

export default async function SuggestionThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string; id: string }>
  searchParams: Promise<{ e?: string }>
}) {
  const [{ handle: owner, slug, id }, sp] = await Promise.all([params, searchParams])
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const sug = await getSuggestion(meta.id, id)
  if (!sug) notFound()
  const [comments, base] = await Promise.all([getSuggestionComments(sug.id), getVersionSteps(meta.id, sug.baseVersion)])
  const path = `/${owner}/${slug}/suggestions/${sug.id}`
  const [sugR, cmtR] = await Promise.all([
    getReactionsFor('suggestion', [sug.id], session?.userId),
    getReactionsFor('suggestion_comment', comments.map((c) => c.id), session?.userId),
  ])

  const isOwner = session?.userId === meta.ownerId
  const canMerge = isOwner || (!!session && (await isCollaborator(meta.id, session.userId)))

  // A3: branch-PR — предлагаемые шаги живут в tip ветки, а не в items;
  // diff строим против ТЕКУЩЕЙ версии main (PR = «ветка → main»).
  const snapshot = sug.branchRef ? await gitCore.branchSnapshot({ owner, slug }, sug.branchRef).catch(() => null) : null
  const branchMissing = !!sug.branchRef && !snapshot
  const items: ProposedItem[] = snapshot
    ? snapshot.steps.map((st) => ({
        title: { en: st.title },
        desc: { en: st.desc },
        command: st.command,
        hasImage: false,
        level: st.level as ProposedItem['level'],
        why: { en: st.why },
        section: { en: st.section },
        subtasks: st.subtasks.map((x) => ({ en: x })),
        refs: st.refs.map((r) => ({ label: { en: r.label }, ...(r.url ? { url: r.url } : {}) })),
      }))
    : (sug.items as ProposedItem[])
  const diffBase = sug.branchRef ? (await getVersionSteps(meta.id, meta.currentVersion))?.steps ?? [] : base?.steps ?? []
  const diff = diffSteps(diffBase, items, lang)

  // A4: для открытого branch-PR заранее считаем трёхсторонний merge — при
  // конфликте вместо кнопки Merge показываем резолвер (выбор по шагам).
  const mergeState =
    sug.branchRef && sug.status === 'open' && canMerge && !branchMissing
      ? await gitCore.mergeState({ owner, slug }, sug.branchRef).catch(() => null)
      : null
  const threeWay = mergeState ? threeWayMerge(mergeState.base, mergeState.ours, mergeState.theirs) : null
  const hasConflicts = !!threeWay && (threeWay.conflicts.length > 0 || threeWay.metaConflicts.length > 0)

  const MERGE_ERR: Record<string, { ru: string; en: string }> = {
    conflict: {
      ru: 'Конфликт: main ушёл вперёд и не сливается автоматически. Обнови ветку (влей main в неё) и попробуй снова.',
      en: 'Conflict: main has diverged and cannot be merged automatically. Update the branch (merge main into it) and retry.',
    },
    'nothing-to-merge': { ru: 'Ветка не содержит новых коммитов относительно main.', en: 'The branch has no new commits over main.' },
    unresolved: { ru: 'Разрешены не все конфликты (или ветка изменилась) — выбери версии заново.', en: 'Not all conflicts were resolved (or the branch changed) — pick again.' },
  }
  const mergeErr = sp.e ? (MERGE_ERR[sp.e] ?? { ru: 'Не удалось выполнить merge.', en: 'Merge failed.' }) : null

  // Участники для @mention: автор правки + комментаторы, без дублей.
  const sugSeen = new Set<string>()
  const sugPeople = [
    { handle: sug.author.handle, avatarUrl: sug.author.avatarUrl },
    ...comments.map((c) => ({ handle: c.authorHandle, avatarUrl: c.authorAvatarUrl })),
  ].filter((p) => p.handle && !sugSeen.has(p.handle) && sugSeen.add(p.handle))
  const fmt = new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', { day: 'numeric', month: 'short', year: 'numeric' })
  const statusLabel = sug.status === 'accepted' ? t('statusAccepted', lang) : sug.status === 'rejected' ? t('statusRejected', lang) : t('statusOpen', lang)
  const statusCls =
    sug.status === 'accepted' ? 'bg-ok text-white' : sug.status === 'rejected' ? 'bg-surface-2 text-muted' : 'bg-accent text-white'

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="suggestions" />
      <div className="mx-auto w-full max-w-[820px] px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold ${statusCls}`}>
            <GitPullRequest size={14} /> {statusLabel}
          </span>
          <span className="text-[13px] text-ink-2">
            {t('proposedBy', lang)}{' '}
            <Link href={`/${sug.author.handle}`} className="font-semibold text-ink hover:text-accent">
              {sug.author.handle}
            </Link>{' '}
            · {fmt.format(new Date(sug.createdAt))} ·{' '}
            {sug.branchRef ? (
              <>
                <Link href={`/${owner}/${slug}?ref=${encodeURIComponent(sug.branchRef)}`} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-ink hover:text-accent">
                  <GitBranch size={11} /> {sug.branchRef}
                </Link>{' '}
                → <span className="font-mono text-[12px]">main</span>
              </>
            ) : (
              <>{lang === 'ru' ? `на основе v${sug.baseVersion}` : `based on v${sug.baseVersion}`}</>
            )}
          </span>
        </div>

        {mergeErr && (
          <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
            {lang === 'ru' ? mergeErr.ru : mergeErr.en}
          </div>
        )}
        {branchMissing && (
          <div className="mb-3 rounded-md border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-[13px] text-warn">
            {lang === 'ru'
              ? `Ветка «${sug.branchRef}» удалена — PR неактуален, можно только отклонить.`
              : `Branch “${sug.branchRef}” was deleted — this PR is stale and can only be closed.`}
          </div>
        )}

        {sug.note && (
          <div className="mb-3 overflow-hidden rounded-lg border border-border bg-surface">
            <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3.5 py-2 text-[12.5px] text-ink-2">
              <Avatar handle={sug.author.handle} avatarUrl={sug.author.avatarUrl} size={22} />
              <span className="font-semibold text-ink">{sug.author.handle}</span>
            </div>
            <div className="px-4 py-3">
              <Markdown refBase={`/${owner}/${slug}/issues`}>{sug.note}</Markdown>
            </div>
          </div>
        )}

        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          {t('proposedChanges', lang)} · {lang === 'ru' ? `v${sug.baseVersion} → правка` : `v${sug.baseVersion} → suggestion`}
        </div>
        <SuggestionDiff rows={diff.rows} summary={diff.summary} lang={lang} />
        <div className="mt-2">
          <Reactions targetType="suggestion" targetId={sug.id} reactions={sugR[sug.id] ?? []} canReact={!!session} path={path} lang={lang} />
        </div>

        {isOwner && !sug.branchRef && sug.status === 'open' && meta.currentVersion > sug.baseVersion && (
          <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-[12.5px] text-warn">
            {lang === 'ru'
              ? `Правка основана на v${sug.baseVersion}, а список уже на v${meta.currentVersion}. Принятие перезапишет более новые изменения (v${sug.baseVersion + 1}–v${meta.currentVersion}).`
              : `This suggestion is based on v${sug.baseVersion}, but the list is now at v${meta.currentVersion}. Accepting will overwrite the newer changes (v${sug.baseVersion + 1}–v${meta.currentVersion}).`}
          </div>
        )}

        {((sug.branchRef ? canMerge : isOwner) && sug.status === 'open') && (
          <div className="mt-3 flex gap-2.5">
            {sug.branchRef ? (
              !branchMissing &&
              !hasConflicts && (
                <form action={mergeBranchPr.bind(null, sug.id)}>
                  <SubmitButton className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-fg">
                    <GitMerge size={14} /> {lang === 'ru' ? 'Влить в main' : 'Merge to main'}
                  </SubmitButton>
                </form>
              )
            ) : (
            <form action={acceptSuggestion.bind(null, sug.id)}>
              <SubmitButton className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-fg">
                <Check size={14} /> {t('accept', lang)}
              </SubmitButton>
            </form>
            )}
            <form action={rejectSuggestion.bind(null, sug.id)}>
              <SubmitButton className="inline-flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-[13px] font-semibold text-ink hover:border-border-strong">
                <X size={14} /> {t('reject', lang)}
              </SubmitButton>
            </form>
          </div>
        )}

        {hasConflicts && threeWay && sug.branchRef && (
          <ConflictResolver
            conflicts={threeWay.conflicts}
            metaConflicts={threeWay.metaConflicts}
            branch={sug.branchRef}
            lang={lang}
            action={resolveBranchPr.bind(null, sug.id)}
          />
        )}

        {/* Обсуждение */}
        <h2 className="mt-6 mb-3 text-[14px] font-bold text-ink">{t('discussionHeading', lang)}</h2>
        {comments.length === 0 ? (
          <p className="mb-3 text-[13px] text-muted">{t('noCommentsYet', lang)}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {comments.map((c) => (
              <CommentCard
                key={c.id}
                handle={c.authorHandle}
                avatarUrl={c.authorAvatarUrl}
                date={c.createdAt}
                body={c.body}
                refBase={`/${owner}/${slug}/issues`}
                lang={lang}
                reactions={<Reactions targetType="suggestion_comment" targetId={c.id} reactions={cmtR[c.id] ?? []} canReact={!!session} path={path} lang={lang} />}
              />
            ))}
          </div>
        )}

        {session ? (
          <div className="mt-4 rounded-lg border border-border bg-surface p-4">
            <form action={addSuggestionComment} className="flex flex-col gap-3">
              <input type="hidden" name="suggestionId" value={sug.id} />
              <MarkdownEditor name="body" rows={4} placeholder={t('writeComment', lang)} maxLength={20000} lang={lang} refScope={{ owner, slug }} people={sugPeople} />
              <div className="flex justify-end">
                <SubmitButton className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg">
                  {t('commentBtn', lang)}
                </SubmitButton>
              </div>
            </form>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-border bg-surface px-4 py-3 text-[13.5px] text-ink-2">
            <Link href={`/login?next=/${owner}/${slug}/suggestions/${sug.id}`} className="font-semibold text-accent hover:underline">
              {t('signInToComment', lang)}
            </Link>
          </div>
        )}
      </div>
    </>
  )
}
