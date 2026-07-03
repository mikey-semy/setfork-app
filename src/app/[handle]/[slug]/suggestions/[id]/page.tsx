import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Check, GitPullRequest, X } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { Markdown } from '@/shared/ui/Markdown'
import { getListMeta, getSuggestion, getSuggestionComments, getVersionSteps } from '@/features/library/queries'
import { acceptSuggestion, addSuggestionComment, rejectSuggestion } from '@/features/library/actions'
import { ListHeader } from '@/features/library/ListHeader'
import { SuggestionDiff } from '@/features/library/SuggestionDiff'
import { diffSteps } from '@/features/library/suggestion-diff'
import { getReactionsFor } from '@/features/reactions/queries'
import { Reactions } from '@/features/reactions/Reactions'
import type { ProposedItem } from '@/shared/db'

const textareaCls = 'w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-none focus:border-border-strong'

export default async function SuggestionThreadPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string; id: string }>
}) {
  const { handle: owner, slug, id } = await params
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const meta = await getListMeta(owner, slug)
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
  const items = sug.items as ProposedItem[]
  const diff = diffSteps(base?.steps ?? [], items, lang)
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
            · {fmt.format(new Date(sug.createdAt))} · {lang === 'ru' ? `на основе v${sug.baseVersion}` : `based on v${sug.baseVersion}`}
          </span>
        </div>

        {sug.note && (
          <div className="mb-3 overflow-hidden rounded-lg border border-border bg-surface">
            <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3.5 py-2 text-[12.5px] text-ink-2">
              <Avatar handle={sug.author.handle} avatarUrl={sug.author.avatarUrl} size={22} />
              <span className="font-semibold text-ink">{sug.author.handle}</span>
            </div>
            <div className="px-4 py-3">
              <Markdown>{sug.note}</Markdown>
            </div>
          </div>
        )}

        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          {t('proposedChanges', lang)} · {lang === 'ru' ? `v${sug.baseVersion} → правка` : `v${sug.baseVersion} → suggestion`}
        </div>
        <SuggestionDiff rows={diff.rows} summary={diff.summary} lang={lang} />
        <div className="mt-2">
          <Reactions targetType="suggestion" targetId={sug.id} reactions={sugR[sug.id] ?? []} canReact={!!session} path={path} />
        </div>

        {isOwner && sug.status === 'open' && (
          <div className="mt-3 flex gap-2.5">
            <form action={acceptSuggestion.bind(null, sug.id)}>
              <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-fg">
                <Check size={14} /> {t('accept', lang)}
              </button>
            </form>
            <form action={rejectSuggestion.bind(null, sug.id)}>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-[13px] font-semibold text-ink hover:border-border-strong">
                <X size={14} /> {t('reject', lang)}
              </button>
            </form>
          </div>
        )}

        {/* Обсуждение */}
        <h2 className="mt-6 mb-3 text-[14px] font-bold text-ink">{t('discussionHeading', lang)}</h2>
        {comments.length === 0 ? (
          <p className="mb-3 text-[13px] text-muted">{t('noCommentsYet', lang)}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {comments.map((c) => (
              <div key={c.id} className="overflow-hidden rounded-lg border border-border bg-surface">
                <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3.5 py-2 text-[12.5px] text-ink-2">
                  <Avatar handle={c.authorHandle} avatarUrl={c.authorAvatarUrl} size={22} />
                  <span className="font-semibold text-ink">{c.authorHandle}</span> · {fmt.format(new Date(c.createdAt))}
                </div>
                <div className="px-4 py-3">
                  <Markdown>{c.body}</Markdown>
                  <div className="mt-2">
                    <Reactions targetType="suggestion_comment" targetId={c.id} reactions={cmtR[c.id] ?? []} canReact={!!session} path={path} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {session ? (
          <div className="mt-4 rounded-lg border border-border bg-surface p-4">
            <form action={addSuggestionComment} className="flex flex-col gap-3">
              <input type="hidden" name="suggestionId" value={sug.id} />
              <textarea name="body" rows={4} className={textareaCls} placeholder={t('writeComment', lang)} maxLength={20000} />
              <div className="flex justify-end">
                <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg">
                  {t('commentBtn', lang)}
                </button>
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
