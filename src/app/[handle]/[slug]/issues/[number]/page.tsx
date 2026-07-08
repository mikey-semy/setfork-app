import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CircleDot, CircleCheck } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Markdown } from '@/shared/ui/Markdown'
import { MarkdownEditor } from '@/shared/ui/MarkdownEditor'
import { requireViewableMeta } from '@/features/library/guard'
import { ListHeader } from '@/widgets/ListHeader'
import { getIssue, getIssueAssignees, getIssueComments, getListLabels } from '@/features/issues/queries'
import { LabelEditor } from '@/features/issues/LabelEditor'
import { AssigneePicker } from '@/features/issues/AssigneePicker'
import { MilestonePicker } from '@/features/issues/MilestonePicker'
import { addIssueComment, setIssueStatus } from '@/features/issues/actions'
import { getMilestonesForPicker } from '@/features/milestones/queries'
import { isCollaborator } from '@/features/collab/queries'
import { getReactionsFor } from '@/features/reactions/queries'
import { Reactions } from '@/features/reactions/Reactions'
import { CommentCard } from '@/features/collab/CommentCard'

export default async function IssueThreadPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string; number: string }>
}) {
  const { handle: owner, slug, number: numStr } = await params
  const number = Number(numStr)
  const [lang, session, meta] = await Promise.all([getLang(), getSession(), requireViewableMeta(owner, slug)])
  if (!meta) notFound()
  const issue = number > 0 ? await getIssue(meta.id, number) : null
  if (!issue) notFound()
  const comments = await getIssueComments(issue.id)
  const path = `/${owner}/${slug}/issues/${issue.number}`
  const [issueR, cmtR, assignees, milestoneOpts, custom] = await Promise.all([
    getReactionsFor('issue', [issue.id], session?.userId),
    getReactionsFor('issue_comment', comments.map((c) => c.id), session?.userId),
    getIssueAssignees(issue.id),
    getMilestonesForPicker(meta.id),
    getListLabels(meta.id),
  ])

  const isOwner = session?.userId === meta.ownerId
  const canManage = isOwner || (session ? await isCollaborator(meta.id, session.userId) : false)

  // Участники для @mention (сразу под курсором): автор + исполнители + комментаторы, без дублей.
  const seenPeople = new Set<string>()
  const issuePeople = [
    { handle: issue.authorHandle, avatarUrl: issue.authorAvatarUrl },
    ...assignees.map((a) => ({ handle: a.handle, avatarUrl: a.avatarUrl })),
    ...comments.map((c) => ({ handle: c.authorHandle, avatarUrl: c.authorAvatarUrl })),
  ].filter((p) => p.handle && !seenPeople.has(p.handle) && seenPeople.add(p.handle))
  const isAuthor = session?.userId === issue.authorId
  const canToggle = isOwner || isAuthor
  const closed = issue.status === 'closed'

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="issues" />
      <div className="mx-auto w-full max-w-[820px] px-4 py-6">
        <div className="mb-1 flex flex-wrap items-start gap-x-2 gap-y-1">
          <h1 className="text-[22px] font-bold leading-tight text-ink">
            {issue.title} <span className="font-normal text-muted">#{issue.number}</span>
          </h1>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold text-white ${
              closed ? 'bg-accent' : 'bg-[var(--ok-solid)]'
            }`}
          >
            {closed ? <CircleCheck size={14} /> : <CircleDot size={14} />}
            {closed ? t('issueClosedBadge', lang) : t('issueOpenBadge', lang)}
          </span>
          <span className="text-[13px] text-ink-2">
            <span className="font-semibold text-ink">{issue.authorHandle}</span> {t('openedThis', lang)} ·{' '}
            {comments.length} {t('commentBtn', lang).toLowerCase()}
          </span>
          <LabelEditor owner={owner} slug={slug} number={issue.number} labels={issue.labels} canEdit={canManage} lang={lang} custom={custom} />
        </div>

        {/* Исполнители + веха */}
        <div className="mb-4 grid gap-4 rounded-lg border border-border bg-surface-2 px-4 py-3 sm:grid-cols-2">
          <AssigneePicker owner={owner} slug={slug} number={issue.number} assignees={assignees} canEdit={canManage} lang={lang} />
          <MilestonePicker
            owner={owner}
            slug={slug}
            number={issue.number}
            current={issue.milestoneId && issue.milestoneTitle ? { id: issue.milestoneId, title: issue.milestoneTitle } : null}
            options={milestoneOpts}
            canEdit={canManage}
            lang={lang}
          />
        </div>

        {/* Тело issue */}
        <CommentCard
          handle={issue.authorHandle}
          avatarUrl={issue.authorAvatarUrl}
          date={issue.createdAt}
          meta={t('openedThis', lang)}
          body={issue.body}
          refBase={`/${owner}/${slug}/issues`}
          lang={lang}
          reactions={<Reactions targetType="issue" targetId={issue.id} reactions={issueR[issue.id] ?? []} canReact={!!session} path={path} lang={lang} />}
        />

        {/* Комментарии */}
        <div className="mt-3 flex flex-col gap-3">
          {comments.map((c) => (
            <CommentCard
              key={c.id}
              handle={c.authorHandle}
              avatarUrl={c.authorAvatarUrl}
              date={c.createdAt}
              meta={t('commentedOn', lang)}
              body={c.body}
              refBase={`/${owner}/${slug}/issues`}
              lang={lang}
              reactions={<Reactions targetType="issue_comment" targetId={c.id} reactions={cmtR[c.id] ?? []} canReact={!!session} path={path} lang={lang} />}
            />
          ))}
        </div>

        {/* Форма ответа */}
        {session ? (
          <div className="mt-5 rounded-lg border border-border bg-surface p-4">
            {/* Отдельная форма смены статуса (сиблинг, не вложенная) — кнопка ниже привязана через form=… */}
            {canToggle && (
              <form id="issue-status-form" action={setIssueStatus.bind(null, owner, slug, issue.number, closed ? 'open' : 'closed')} className="hidden" />
            )}
            <form action={addIssueComment} className="flex flex-col gap-3">
              <input type="hidden" name="owner" value={owner} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="number" value={issue.number} />
              <MarkdownEditor name="body" rows={4} placeholder={t('writeComment', lang)} maxLength={20000} lang={lang} refScope={{ owner, slug }} people={issuePeople} />
              <div className="flex flex-wrap items-center justify-end gap-2">
                {canToggle && (
                  <button
                    type="submit"
                    form="issue-status-form"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-[13px] font-semibold text-ink hover:border-border-strong"
                  >
                    {closed ? <CircleDot size={14} className="text-ok" /> : <CircleCheck size={14} className="text-accent" />}
                    {closed ? t('reopenIssue', lang) : t('closeIssue', lang)}
                  </button>
                )}
                <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg">
                  {t('commentBtn', lang)}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-border bg-surface px-4 py-3 text-[13.5px] text-ink-2">
            <Link href={`/login?next=/${owner}/${slug}/issues/${issue.number}`} className="font-semibold text-accent hover:underline">
              {t('signInToComment', lang)}
            </Link>
          </div>
        )}
      </div>
    </>
  )
}
