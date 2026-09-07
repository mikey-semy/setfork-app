import Link from 'next/link'
import { Avatar } from '@/shared/ui/Avatar'
import { AsideCard, PageAside } from '@/shared/ui/PageAside'
import { t, type Lang } from '@/shared/i18n'
import { AssigneePicker } from '@/features/issues/AssigneePicker'
import { LabelEditor } from '@/features/issues/LabelEditor'
import { MilestonePicker } from '@/features/issues/MilestonePicker'
import { LinkIssuePicker } from '@/features/library/LinkIssuePicker'
import { WatchButton } from '@/features/watch/WatchButton'
import { LockToggle } from '@/features/library/LockToggle'
import { closingRefs } from '@/features/library/closing-refs'
import { setSuggestionLabels, setSuggestionMilestone, toggleReviewRequest, toggleSuggestionAssignee } from '@/features/library/suggestion-meta-actions'
import type { loadSuggestionPage } from './load'

/**
 * Боковая колонка страницы предложения: ревью, подписка, метки, рецензенты,
 * исполнители, веха и связанные задачи.
 *
 * Отдельно от вкладок, потому что живёт своей жизнью: она одна и та же, какую бы
 * вкладку ни открыли, и меняется вместе с набором свойств предложения, а не с тем,
 * как показан дифф.
 */
type Loaded = Awaited<ReturnType<typeof loadSuggestionPage>>

export function SuggestionAside({
  owner,
  slug,
  lang,
  session,
  data,
}: {
  owner: string
  slug: string
  lang: Lang
  session: { userId: string; handle: string } | null
  data: Loaded
}) {
  const { sugPeople, assignees, canLinkIssues, canMerge, curMilestone, customLabels, items, linkedIssues, meta, msOptions, openIssues, reviewRequests, reviews, sug, watchCount, watchState } = data
  return (
      <PageAside>
        <AsideCard title={t('reviewTitle', lang)}>
          {reviews.length === 0 ? (
            <p className="text-body-sm text-muted">{t('reviewNobodyYet', lang)}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {reviews.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-body-sm">
                  <Avatar handle={r.reviewer.handle} avatarUrl={r.reviewer.avatarUrl} size={20} />
                  <span className="min-w-0 flex-1 truncate text-ink-2">{r.reviewer.name || r.reviewer.handle}</span>
                  <span className={r.verdict === 'approve' ? 'text-ok' : r.verdict === 'changes' ? 'text-danger' : 'text-muted'}>
                    {r.verdict === 'approve' ? t('reviewApprove', lang) : r.verdict === 'changes' ? t('reviewRequestChanges', lang) : t('reviewCommentOnly', lang)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AsideCard>

        {session && watchState && (
          <AsideCard title={t('notifications', lang)}>
            <WatchButton
              templateId={meta.id}
              state={watchState}
              count={watchCount}
              labels={{
                watch: t('watch', lang),
                unwatch: t('unwatch', lang),
                title: t('watchTitle', lang),
                participating: t('watchParticipating', lang),
                participatingDesc: t('watchParticipatingDesc', lang),
                all: t('watchAll', lang),
                allDesc: t('watchAllDesc', lang),
                ignore: t('watchIgnore', lang),
                ignoreDesc: t('watchIgnoreDesc', lang),
                custom: t('watchCustom', lang),
                customDesc: t('watchCustomDesc', lang),
                customTitle: t('watchCustomTitle', lang),
                evVersions: t('versionsTab', lang),
                evIssues: t('issuesTab', lang),
                evDiscussions: t('featDiscussions', lang),
                evSuggestions: t('suggestions', lang),
                apply: t('apply', lang),
              }}
            />
          </AsideCard>
        )}

        <AsideCard title={t('labelsLabel', lang)}>
          <LabelEditor
            owner={owner}
            slug={slug}
            labels={(sug.labels as string[]) ?? []}
            canEdit={canMerge}
            lang={lang}
            custom={customLabels}
            onSave={setSuggestionLabels.bind(null, sug.id)}
          />
        </AsideCard>

        {/* Запрошенные рецензенты — ТОТ ЖЕ пикер, что исполнители: набор людей
            с поиском по handle. Разница только в подписях и в действии. */}
        <AsideCard>
          <AssigneePicker
            owner={owner}
            slug={slug}
            assignees={reviewRequests}
            canEdit={canMerge || session?.userId === sug.authorId}
            lang={lang}
            onToggle={toggleReviewRequest.bind(null, sug.id)}
            labels={{
              title: t('prReviewers', lang),
              add: t('prRequestReview', lang),
              empty: t('prReviewersEmpty', lang),
              remove: t('prCancelRequest', lang),
            }}
          />
        </AsideCard>

        <AsideCard>
          <AssigneePicker
            owner={owner}
            slug={slug}
            assignees={assignees}
            canEdit={canMerge}
            lang={lang}
            onToggle={toggleSuggestionAssignee.bind(null, sug.id)}
          />
        </AsideCard>

        <AsideCard>
          <MilestonePicker
            owner={owner}
            slug={slug}
            current={curMilestone}
            options={msOptions}
            canEdit={canMerge}
            lang={lang}
            onSet={setSuggestionMilestone.bind(null, sug.id)}
          />
        </AsideCard>

        {/* Development у GitHub: какие задачи закроет слияние. Привязка живёт
            строкой `closes #N` в тексте — пикер её дописывает, поэтому набранное
            руками и выбранное мышью это одно и то же. */}
        {(linkedIssues.length > 0 || (canLinkIssues && openIssues.length > 0)) && (
          <AsideCard title={t('prLinkedIssues', lang)}>
            {linkedIssues.length > 0 && (
              <ul className="mb-1.5 flex flex-col gap-1.5">
                {linkedIssues.map((iss) => (
                  <li key={iss.number} className="flex items-start gap-1.5 text-body-sm">
                    <Link href={`/${owner}/${slug}/issues/${iss.number}`} className="font-mono text-muted hover:text-accent">
                      #{iss.number}
                    </Link>
                    <span className={`min-w-0 flex-1 ${iss.status === 'closed' ? 'text-muted line-through' : 'text-ink-2'}`}>{iss.title}</span>
                  </li>
                ))}
              </ul>
            )}
            <LinkIssuePicker
              suggestionId={sug.id}
              issues={openIssues}
              linked={closingRefs(sug.note)}
              canEdit={canLinkIssues}
              labels={{
                add: t('prLinkIssue', lang),
                empty: t('prLinkIssueEmpty', lang),
                filter: t('prLinkIssueFilter', lang),
                remove: t('prLinkIssueRemove', lang),
                hint: t('prLinkedIssuesHint', lang),
                clear: t('clear', lang),
              }}
            />
          </AsideCard>
        )}

        {/* Замок обсуждения — служебное и редкое, поэтому в самом низу панели,
            а не рядом с частыми действиями. */}
        {canMerge && (
          <AsideCard>
            <LockToggle
              suggestionId={sug.id}
              locked={!!sug.lockedAt}
              labels={{ lock: t('prLock', lang), unlock: t('prUnlock', lang), hint: t('prLockHint', lang) }}
              // Подписи причин — из того же словаря, что у задач: перечень общий.
              reasonLabels={{
                off_topic: t('issue.lockReason.off_topic', lang),
                too_heated: t('issue.lockReason.too_heated', lang),
                resolved: t('issue.lockReason.resolved', lang),
                spam: t('issue.lockReason.spam', lang),
              }}
            />
          </AsideCard>
        )}

        <AsideCard title={t('participants', lang)}>
          <div className="flex flex-wrap gap-1.5">
            {sugPeople.map((p) => (
              <Link key={p.handle} href={`/${p.handle}`} title={p.handle}>
                <Avatar handle={p.handle} avatarUrl={p.avatarUrl} size={24} />
              </Link>
            ))}
          </div>
        </AsideCard>
      </PageAside>
  )
}
