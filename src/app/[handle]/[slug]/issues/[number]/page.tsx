import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CircleDot, CircleCheck } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { Markdown } from '@/shared/ui/Markdown'
import { MarkdownEditor } from '@/shared/ui/MarkdownEditor'
import { requireViewableMeta } from '@/features/library/guard'
import { getIssue, getIssueAssignees, getIssueCommentsPage, getIssueParticipants, getListLabels } from '@/features/issues/queries'
import { LabelEditor } from '@/features/issues/LabelEditor'
import { AssigneePicker } from '@/features/issues/AssigneePicker'
import { MilestonePicker } from '@/features/issues/MilestonePicker'
import { addIssueComment, setIssueStatus } from '@/features/issues/actions'
import { getMilestonesForPicker } from '@/features/milestones/queries'
import { isCollaborator } from '@/features/collab/queries'
import { getReactionsFor } from '@/features/reactions/queries'
import { Reactions } from '@/features/reactions/Reactions'
import { CommentCard } from '@/features/collab/CommentCard'
import { PAGE_NARROW } from '@/shared/ui/control'
import { isFeatureEnabled } from '@/core'
import { cardClass } from '@/shared/ui/card-style'
import { Pagination } from '@/shared/ui/Pagination'
import { Badge } from '@/shared/ui/badge'
import { AFTER_PARAM, BEFORE_PARAM, COMMENTS_PER_PAGE, cursorHref, readCursor } from '@/shared/lib/paging'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string; number: string }> }) {
  const [{ handle, slug, number }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('issueWord', lang)} #${number} · ${handle}/${slug}` }
}

export default async function IssueThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string; number: string }>
  searchParams: Promise<{ after?: string; before?: string }>
}) {
  const { handle: owner, slug, number: numStr } = await params
  const sp = await searchParams
  const number = Number(numStr)
  const [lang, session, meta] = await Promise.all([getLang(), getSession(), requireViewableMeta(owner, slug)])
  if (!meta) notFound()
  // Тот же предикат, что у записи (canWriteToFeature): страница отражает решение
  // владельца, но не заменяет его — проверка живёт в actions.
  if (!isFeatureEnabled(meta, 'issues')) notFound() // раздел выключен (Settings → Features)
  const issue = number > 0 ? await getIssue(meta.id, number) : null
  if (!issue) notFound()
  // Тред листается ключом, а не отдаётся целиком: у обсуждения на тысячу реплик страница
  // поднимала тысячу строк с аватарами, чтобы показать экран. Мусорный курсор — «показать
  // сначала», а не пятисотка.
  const { cursor, dir } = readCursor(sp)
  const thread = await getIssueCommentsPage(issue.id, COMMENTS_PER_PAGE, cursor, dir)
  const comments = thread.items
  const path = `/${owner}/${slug}/issues/${issue.number}`
  const [issueR, cmtR, assignees, milestoneOpts, custom, participants] = await Promise.all([
    getReactionsFor('issue', [issue.id], session?.userId),
    getReactionsFor('issue_comment', comments.map((c) => c.id), session?.userId),
    getIssueAssignees(issue.id),
    getMilestonesForPicker(meta.id),
    getListLabels(meta.id),
    // Участники — по всему треду, а не по показанной порции: иначе на второй порции
    // подсказка @mention забывала бы половину людей.
    getIssueParticipants(issue.id),
  ])

  const isOwner = session?.userId === meta.ownerId
  const canManage = isOwner || (session ? await isCollaborator(meta.id, session.userId) : false)

  // Участники для @mention (сразу под курсором): автор + исполнители + комментаторы, без дублей.
  const seenPeople = new Set<string>()
  const issuePeople = [
    { handle: issue.authorHandle, avatarUrl: issue.authorAvatarUrl },
    ...assignees.map((a) => ({ handle: a.handle, avatarUrl: a.avatarUrl })),
    ...participants,
  ].filter((p) => p.handle && !seenPeople.has(p.handle) && seenPeople.add(p.handle))
  const isAuthor = session?.userId === issue.authorId
  const canToggle = isOwner || isAuthor
  const closed = issue.status === 'closed'

  return (
    <>
      <div className={PAGE_NARROW}>
        <div className="mb-1 flex flex-wrap items-start gap-x-2 gap-y-1">
          <h1 className="text-stat font-bold leading-tight text-ink [overflow-wrap:anywhere]">
            {issue.title} <span className="font-normal text-muted">#{issue.number}</span>
          </h1>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Badge size="md" variant={closed ? 'accentSolid' : 'okSolid'} className="gap-1.5 px-3">
            {closed ? <CircleCheck size={14} /> : <CircleDot size={14} />}
            {closed ? t('issueClosedBadge', lang) : t('issueOpenBadge', lang)}
          </Badge>
          <span className="text-body text-ink-2">
            <span className="font-semibold text-ink">{issue.authorHandle}</span> {t('openedThis', lang)} ·{' '}
            {comments.length} {t('commentBtn', lang).toLowerCase()}
          </span>
          <LabelEditor owner={owner} slug={slug} number={issue.number} labels={issue.labels} canEdit={canManage} lang={lang} custom={custom} />
        </div>

        {/* Исполнители + веха */}
        {/* grid-cols-1 на мобиле: без него трек неявный (auto) и берёт min-content
            содержимого — длинное название вехи раздувало сетку до 908px при экране 390. */}
        <div className="mb-4 grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface-2 px-4 py-3 sm:grid-cols-2">
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

        {/* Шаги треда. Номеров нет: порядок показа обратный ленте, но механика та же —
            «дальше» ведёт к более поздним репликам. */}
        <Pagination
          lang={lang}
          steps={{
            prev: thread.prev ? cursorHref(path, sp, BEFORE_PARAM)(thread.prev) : null,
            next: thread.next ? cursorHref(path, sp, AFTER_PARAM)(thread.next) : null,
          }}
        />

        {/* Форма ответа */}
        {session ? (
          <div className={cardClass({ className: 'mt-5' })}>
            {/* Отдельная форма смены статуса (сиблинг, не вложенная) — кнопка ниже привязана через form=… */}
            {canToggle && (
              <form id="issue-status-form" action={setIssueStatus.bind(null, owner, slug, issue.number, closed ? 'open' : 'closed')} className="hidden" />
            )}
            <form action={addIssueComment} className="flex flex-col gap-3">
              <input type="hidden" name="owner" value={owner} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="number" value={issue.number} />
              <MarkdownEditor name="body" rows={4} placeholder={t('writeComment', lang)} maxLength={20000} lang={lang} refScope={{ owner, slug }} people={issuePeople} />
              <div className="flex flex-wrap items-center justify-end gap-3">
                {canToggle && (
                  <Button type="submit" form="issue-status-form" size="md">
                    {closed ? <CircleDot size={14} className="text-ok" /> : <CircleCheck size={14} className="text-accent" />}
                    {closed ? t('reopenIssue', lang) : t('closeIssue', lang)}
                  </Button>
                )}
                <Button type="submit" variant="primary" size="md">
                  {t('commentBtn', lang)}
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-border bg-surface px-4 py-3 text-body text-ink-2">
            <Link href={`/login?next=/${owner}/${slug}/issues/${issue.number}`} className="font-semibold text-accent hover:underline">
              {t('signInToComment', lang)}
            </Link>
          </div>
        )}
      </div>
    </>
  )
}
