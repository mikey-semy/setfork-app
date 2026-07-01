import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Check, X } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr, type LocaleText } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { getSuggestions, getTemplateDetail } from '@/features/library/queries'
import { acceptSuggestion, rejectSuggestion } from '@/features/library/actions'
import type { ProposedItem } from '@/shared/db'

export default async function SuggestionsPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>
}) {
  const { handle: owner, slug } = await params
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const detail = await getTemplateDetail(owner, slug)
  if (!detail) notFound()
  const { tpl } = detail
  const isOwner = session?.userId === tpl.ownerId
  const list = await getSuggestions(tpl.id)

  const statusLabel = (s: string) =>
    s === 'accepted' ? t('statusAccepted', lang) : s === 'rejected' ? t('statusRejected', lang) : t('statusOpen', lang)
  const statusCls = (s: string) =>
    s === 'accepted'
      ? 'bg-[var(--accent-soft)] text-[var(--ok)]'
      : s === 'rejected'
        ? 'bg-surface-2 text-muted'
        : 'bg-[var(--accent-soft)] text-accent'

  return (
    <div className="mx-auto w-full max-w-[780px] px-6 py-8">
      <Link href={`/${owner}/${slug}`} className="mb-4 inline-flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> {tpl.owner.handle}/{tpl.slug}
      </Link>
      <h1 className="mb-5 text-[18px] font-bold text-ink">
        {t('suggestions', lang)} <span className="text-muted">{list.length}</span>
      </h1>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-[13.5px] text-muted">
          {t('noSuggestions', lang)}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {list.map((s) => {
            const items = s.items as ProposedItem[]
            return (
              <div key={s.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex items-center gap-2.5">
                  <Avatar handle={s.author.handle} avatarUrl={s.author.avatarUrl} size={26} />
                  <span className="text-[13px] text-ink-2">
                    {t('proposedBy', lang)}{' '}
                    <Link href={`/${s.author.handle}`} className="font-semibold text-ink hover:text-accent">
                      {s.author.handle}
                    </Link>
                  </span>
                  <span className="font-mono text-[11px] text-muted">
                    {new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', { month: 'short', day: 'numeric' }).format(
                      new Date(s.createdAt),
                    )}
                  </span>
                  <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusCls(s.status)}`}>
                    {statusLabel(s.status)}
                  </span>
                </div>

                {s.note && <p className="mt-2.5 text-[13.5px] text-ink">{s.note}</p>}

                <div className="mt-3 rounded-md border border-border bg-surface-2 p-3">
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                    {lang === 'ru' ? `Предложено · ${items.length} пунктов` : `Proposed · ${items.length} items`}
                  </div>
                  <ol className="flex flex-col gap-1">
                    {items.map((it, i) => (
                      <li key={i} className="flex gap-2 text-[13px] text-ink-2">
                        <span className="font-mono text-muted">{i + 1}</span>
                        <span className="text-ink">{tr(it.title as LocaleText, lang)}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                {isOwner && s.status === 'open' && (
                  <div className="mt-3 flex gap-2.5">
                    <form action={acceptSuggestion.bind(null, s.id)}>
                      <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-fg">
                        <Check size={14} /> {t('accept', lang)}
                      </button>
                    </form>
                    <form action={rejectSuggestion.bind(null, s.id)}>
                      <button className="inline-flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-[13px] font-semibold text-ink hover:border-border-strong">
                        <X size={14} /> {t('reject', lang)}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
