import Link from 'next/link'
import { Check, GitMerge, Lock, RefreshCw, X } from 'lucide-react'
import { Alert } from '@/shared/ui/Alert'
import { Avatar } from '@/shared/ui/Avatar'
import { Markdown } from '@/shared/ui/Markdown'
import { MarkdownEditor } from '@/shared/ui/MarkdownEditor'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { fill, t, type Lang, type TKey } from '@/shared/i18n'
import { acceptSuggestion, addSuggestionComment, mergeBranchPr, rejectSuggestion, resolveBranchPr, updateBranchFromMain } from '@/features/library/actions/suggestions'
import { ConflictResolver } from '@/features/git/ConflictResolver'
import { CommentCard } from '@/features/collab/CommentCard'
import { CommentActions } from '@/features/collab/CommentActions'
import { Reactions } from '@/features/reactions/Reactions'
import { DraftToggle } from '@/features/library/DraftToggle'
import { MergedPanel } from '@/features/library/MergedPanel'
import { setSuggestionDraft } from '@/features/library/suggestion-meta-actions'
import { SuggestionTimeline } from '@/features/library/SuggestionTimeline'
import type { ReactNode } from 'react'
import type { loadSuggestionPage } from './load'
import { cardClass } from '@/shared/ui/card-style'
import { Pagination } from '@/shared/ui/Pagination'

/**
 * Вкладка обсуждения: заметка правки, разговор, ревью, слияние и история действий.
 *
 * Отдельно от остальных вкладок, потому что это единственная, где принимают решение:
 * здесь и причины, по которым слить нельзя, и сама кнопка слияния, и разрешение
 * конфликтов. Дифф, проверки и коммиты только показывают состояние.
 */
type Loaded = Awaited<ReturnType<typeof loadSuggestionPage>>

export function SuggestionConversation({
  owner,
  slug,
  lang,
  session,
  data,
  reviewPanel,
}: {
  owner: string
  slug: string
  lang: Lang
  session: { userId: string; handle: string } | null
  data: Loaded
  /** Панель ревью приходит готовой: она нужна и здесь, и под диффом. */
  reviewPanel: ReactNode
}) {
  const { sug, path, comments, threadSteps, cmtR, sugR, canMerge, isOwner, meta, items, prs, blockReasons, timeline, sugPeople, threeWay, hasConflicts, branchBehind, branchMissing, isDraft } = data
  const locked = !!sug.lockedAt
  const lockReasonText = sug.lockReason ? t(`issue.lockReason.${sug.lockReason}` as TKey, lang) : ''
  return (
    <>
        {/* Заметка правки — первое сообщение обсуждения (как тело PR у GitHub), а
            не шапка на всех вкладках: в «Проверках» и «Изменениях» она мешала. */}
        {sug.note && (
          <div className="mb-3 overflow-hidden rounded-lg border border-border bg-surface">
            <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3.5 py-2 text-body-sm text-ink-2">
              <Avatar handle={sug.author.handle} avatarUrl={sug.author.avatarUrl} size={22} />
              <span className="font-semibold text-ink">{sug.author.handle}</span>
            </div>
            <div className="px-4 py-3">
              <Markdown refBase={`/${owner}/${slug}/issues`}>{sug.note}</Markdown>
              <div className="mt-2">
                <Reactions targetType="suggestion" targetId={sug.id} reactions={sugR[sug.id] ?? []} canReact={!!session} path={path} lang={lang} />
              </div>
            </div>
          </div>
        )}

        <SuggestionTimeline
          events={timeline}
          lang={lang}
          labels={{
            opened: t('tlOpened', lang),
            approved: t('tlApproved', lang),
            requestedChanges: t('tlRequestedChanges', lang),
            commented: t('tlCommented', lang),
            resolved: t('tlResolved', lang),
            merged: t('tlMerged', lang),
            closed: t('tlClosed', lang),
          }}
        />
        <h2 className="mt-6 mb-3 text-body-lg font-bold text-ink">{t('discussionHeading', lang)}</h2>
        {comments.length === 0 ? (
          <p className="mb-3 text-body text-muted">{t('noCommentsYet', lang)}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {comments.map((c) => (
              <CommentCard
                key={c.id}
                id={c.id}
                actions={
                  <CommentActions
                    commentId={c.id}
                    body={c.body}
                    path={path}
                    canEdit={session?.userId === c.authorId}
                    lang={lang}
                    labels={{
                      more: t('cmMore', lang),
                      copyLink: t('cmCopyLink', lang),
                      copyMarkdown: t('cmCopyMarkdown', lang),
                      quoteReply: t('cmQuoteReply', lang),
                      edit: t('cmEdit', lang),
                      save: t('cmSave', lang),
                      cancel: t('commentCancel', lang),
                    }}
                  />
                }
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
        {/* Шаги треда — номеров нет, порядок показа от старого к новому. */}
        <Pagination lang={lang} steps={threadSteps} />

        {/* Блок слияния — там же, где обсуждение: решение принимают, прочитав
            разговор. Предупреждение про устаревшую базу и резолвер конфликтов
            стоят рядом с кнопкой, а не на вкладке изменений. */}
        {isOwner && !sug.branchRef && sug.status === 'open' && meta.currentVersion > sug.baseVersion && (
          <Alert variant="warn" className="mt-3">
            {lang === 'ru'
              ? `Предложение основано на v${sug.baseVersion}, а список уже на v${meta.currentVersion}. Принятие перезапишет более новые изменения (v${sug.baseVersion + 1}–v${meta.currentVersion}).`
              : `This suggestion is based on v${sug.baseVersion}, but the list is now at v${meta.currentVersion}. Accepting will overwrite the newer changes (v${sug.baseVersion + 1}–v${meta.currentVersion}).`}
          </Alert>
        )}

        {/* Черновик: слияния нет, вместо него — отметка готовности (автор или мейнтейнер). */}
        {isDraft && (session?.userId === sug.authorId || canMerge) && (
          <DraftToggle
            draft
            action={setSuggestionDraft.bind(null, sug.id)}
            labels={{ ready: t('prReadyForReview', lang), back: t('prBackToDraft', lang), hint: t('prDraftHint', lang) }}
          />
        )}

        {/* Ветка отстала от main — обратное слияние одной кнопкой. Показываем и при
            конфликте: как раз тогда обновление чаще всего и решает дело. */}
        {branchBehind && sug.status === 'open' && !branchMissing && (
          <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-md border border-border bg-surface-2 px-3.5 py-2.5">
            <span className="text-body-sm text-ink-2">{t('prBranchBehind', lang)}</span>
            <form action={updateBranchFromMain.bind(null, sug.id)} className="ml-auto">
              <SubmitButton variant="outline">
                <RefreshCw size={14} /> {t('prUpdateBranch', lang)}
              </SubmitButton>
            </form>
          </div>
        )}

        {blockReasons.length > 0 && sug.status === 'open' && !isDraft && (
          <Alert variant="danger" className="mt-3">
            {t('prMergeBlocked', lang)}: {blockReasons.join('; ')}
          </Alert>
        )}

        {((sug.branchRef ? canMerge : isOwner) && sug.status === 'open' && !isDraft) && (
          <div className="mt-3 flex gap-2.5">
            {/* Кнопка слияния прячется при блокировке, «Отклонить» — нет: отклонить
                предложение можно в любом состоянии, это не обход гейта. */}
            {blockReasons.length > 0 ? null : sug.branchRef ? (
              !branchMissing &&
              !hasConflicts && (
                <form action={mergeBranchPr.bind(null, sug.id)}>
                  <SubmitButton>
                    <GitMerge size={14} />
                    {/* На мобиле одно слово, на широком — полное действие: способ
                        слияния меняет результат, и знать о нём надо ДО нажатия. */}
                    <span className="sm:hidden">{t('prMergeShort', lang)}</span>
                    <span className="hidden sm:inline">
                      {prs.mergeMethod === 'squash' ? t('prSquashAndMerge', lang) : t('prMergeToMain', lang)}
                    </span>
                  </SubmitButton>
                </form>
              )
            ) : (
              <form action={acceptSuggestion.bind(null, sug.id)}>
                <SubmitButton>
                  <Check size={14} /> {t('accept', lang)}
                </SubmitButton>
              </form>
            )}
            <form action={rejectSuggestion.bind(null, sug.id)}>
              <SubmitButton variant="outline">
                <X size={14} /> {t('reject', lang)}
              </SubmitButton>
            </form>
          </div>
        )}

        {!isDraft && sug.status === 'open' && (session?.userId === sug.authorId || canMerge) && (
          <DraftToggle
            draft={false}
            action={setSuggestionDraft.bind(null, sug.id)}
            labels={{ ready: t('prReadyForReview', lang), back: t('prBackToDraft', lang), hint: t('prDraftHint', lang) }}
          />
        )}

        {/* Резолвер — только тому, кто может сливать: его экшен всё равно требует
            прав, а показывать автору форму, которая ничего не сделает, — обман. */}
        {hasConflicts && threeWay && sug.branchRef && canMerge && (
          <ConflictResolver
            conflicts={threeWay.conflicts}
            metaConflicts={threeWay.metaConflicts}
            branch={sug.branchRef}
            lang={lang}
            action={resolveBranchPr.bind(null, sug.id)}
          />
        )}

        {reviewPanel}

        {/* ⚠️ ЗАПЕРТО — ГОВОРИМ ОБ ЭТОМ. Раньше форма показывалась всегда, а экшен молча
            возвращался: человек писал ответ, жал кнопку и не получал ничего. Плашка
            называет причину, форма убирается — как на странице задачи. */}
        {locked && (
          <Alert variant="warn" icon={Lock} className="mt-4">
            {/* ⚠️ ТЕКСТ СВОЙ, А НЕ ИЗ ЗАДАЧ. Там сказано «отвечать могут владелец и
                участники с правом записи» — у правок это НЕПРАВДА: замок не обходит
                никто, включая того, кто его повесил (см. actions/suggestion-comments).
                Поймано живым прогоном: плашка обещала владельцу то, чего он не может. */}
            {lockReasonText ? fill('pr.lockedNotice', lang, { reason: lockReasonText }) : t('pr.lockedNoticePlain', lang)}
          </Alert>
        )}

        {session && !locked ? (
          <div className={cardClass({ className: 'mt-4' })}>
            <form action={addSuggestionComment} className="flex flex-col gap-3">
              <input type="hidden" name="suggestionId" value={sug.id} />
              <MarkdownEditor name="body" rows={4} placeholder={t('writeComment', lang)} maxLength={20000} lang={lang} refScope={{ owner, slug }} people={sugPeople} />
              <div className="flex justify-end">
                <SubmitButton>
                  {t('commentBtn', lang)}
                </SubmitButton>
              </div>
            </form>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-border bg-surface px-4 py-3 text-body text-ink-2">
            <Link href={`/login?next=${path}`} className="font-semibold text-accent hover:underline">
              {t('signInToComment', lang)}
            </Link>
          </div>
        )}
    </>
  )
}
