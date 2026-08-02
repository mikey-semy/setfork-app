import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Markdown } from '@/shared/ui/Markdown'
import { MarkdownEditor } from '@/shared/ui/MarkdownEditor'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { timeAgo } from '@/shared/ui/timeAgo'
import { Tooltip } from '@/shared/ui/Tooltip'
import { UserLine } from '@/shared/ui/UserLine'
import { requireViewableMeta } from '@/features/library/guard'
import { getDiscussion, getDiscussionComments } from '@/features/discussions/queries'
import { addDiscussionComment } from '@/features/discussions/actions'
import { categoryLabel, categoryMeta } from '@/features/discussions/constants'
import { PAGE_NARROW } from '@/shared/ui/control'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string; number: string }> }) {
  const [{ handle, slug, number }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('discussionHeading', lang)} #${number} · ${handle}/${slug}` }
}

export default async function DiscussionThreadPage({ params }: { params: Promise<{ handle: string; slug: string; number: string }> }) {
  const { handle: owner, slug, number: numStr } = await params
  const number = Number(numStr)
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const ru = lang === 'ru'
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  if (!meta.discussionsEnabled) notFound() // раздел выключен владельцем (Settings → Features)
  const disc = number > 0 ? await getDiscussion(meta.id, number) : null
  if (!disc) notFound()
  const comments = await getDiscussionComments(disc.id)
  const base = `/${owner}/${slug}/discussions`

  const card = 'rounded-lg border border-border bg-surface'
  return (
    <>
      <div className={PAGE_NARROW}>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Tooltip label={categoryLabel(disc.category, lang)}>
            <span className="text-[1rem]">{categoryMeta(disc.category).icon}</span>
          </Tooltip>
          <h1 className="text-[1.375rem] font-bold leading-tight text-ink">
            {disc.title} <span className="font-normal text-muted">#{disc.number}</span>
          </h1>
        </div>
        <div className="mb-4 text-[0.8125rem] text-ink-2">
          <span className="font-semibold text-ink">{disc.authorHandle}</span> · {timeAgo(disc.createdAt, lang)} ·{' '}
          <Link href={`${base}?category=${disc.category}`} className="hover:text-accent">{categoryLabel(disc.category, lang)}</Link>
        </div>

        {/* Первый пост */}
        <div className={`${card} mb-4 p-4`}>
          <div className="mb-2 flex items-center gap-2">
            <UserLine handle={disc.authorHandle} avatarUrl={disc.authorAvatarUrl} size="sm" at={timeAgo(disc.createdAt, lang)} />
          </div>
          {disc.body ? <Markdown>{disc.body}</Markdown> : <p className="text-[0.8125rem] text-muted">{ru ? '(без описания)' : '(no description)'}</p>}
        </div>

        {/* Ответы */}
        {comments.length > 0 && (
          <div className="mb-4 flex flex-col gap-3">
            {comments.map((c) => (
              <div key={c.id} className={`${card} p-4`}>
                <div className="mb-2 flex items-center gap-2">
                  <UserLine handle={c.authorHandle} avatarUrl={c.authorAvatarUrl} size="sm" at={timeAgo(c.createdAt, lang)} />
                </div>
                <Markdown>{c.body}</Markdown>
              </div>
            ))}
          </div>
        )}

        {/* Ответить */}
        {session ? (
          <form action={addDiscussionComment} className={`${card} p-3`}>
            <input type="hidden" name="owner" value={owner} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="number" value={number} />
            <MarkdownEditor name="body" rows={5} placeholder={ru ? 'Ответить…' : 'Write a reply…'} maxLength={20000} lang={lang} refScope={{ owner, slug }} />
            <div className="mt-2 flex justify-end">
              <SubmitButton>
                {ru ? 'Ответить' : 'Comment'}
              </SubmitButton>
            </div>
          </form>
        ) : (
          <p className="text-[0.8125rem] text-muted">
            <Link href="/login" className="text-accent hover:underline">{ru ? 'Войдите' : 'Sign in'}</Link> {ru ? ', чтобы ответить.' : 'to reply.'}
          </p>
        )}
      </div>
    </>
  )
}
