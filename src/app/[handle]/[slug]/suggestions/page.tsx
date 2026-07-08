import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t, tr, type LocaleText } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { getSuggestions } from '@/features/library/queries'
import { requireViewableMeta } from '@/features/library/guard'
import { ListHeader } from '@/widgets/ListHeader'
import type { ProposedItem } from '@/shared/db'

export default async function SuggestionsPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>
}) {
  const [{ handle: owner, slug }, lang] = await Promise.all([params, getLang()])
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const list = await getSuggestions(meta.id)
  const base = `/${owner}/${slug}/suggestions`

  const statusLabel = (s: string) =>
    s === 'accepted' ? t('statusAccepted', lang) : s === 'rejected' ? t('statusRejected', lang) : t('statusOpen', lang)
  const statusCls = (s: string) =>
    s === 'accepted'
      ? 'bg-(--accent-soft) text-ok'
      : s === 'rejected'
        ? 'bg-surface-2 text-muted'
        : 'bg-(--accent-soft) text-accent'

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="suggestions" />
      <div className="mx-auto w-full max-w-[820px] px-4 py-6">
      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-[13.5px] text-muted">
          {t('noSuggestions', lang)}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {list.map((s) => {
            const items = s.items as ProposedItem[]
            const first = items[0] ? tr(items[0].title as LocaleText, lang) : ''
            return (
              <Link key={s.id} href={`${base}/${s.id}`} className="block rounded-lg border border-border bg-surface p-4 hover:border-border-strong">
                <div className="flex items-center gap-2.5">
                  <Avatar handle={s.author.handle} avatarUrl={s.author.avatarUrl} size={26} />
                  <span className="text-[13px] text-ink-2">
                    {t('proposedBy', lang)} <span className="font-semibold text-ink">{s.author.handle}</span>
                  </span>
                  <span className="font-mono text-[11px] text-muted">
                    {new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', { month: 'short', day: 'numeric' }).format(
                      new Date(s.createdAt),
                    )}
                  </span>
                  {s.commentCount > 0 && (
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted">
                      <MessageSquare size={12} /> {s.commentCount}
                    </span>
                  )}
                  <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusCls(s.status)}`}>
                    {statusLabel(s.status)}
                  </span>
                </div>

                <p className="mt-2.5 text-[13.5px] font-medium text-ink">
                  {s.note || first || (lang === 'ru' ? `Правка · ${items.length} пунктов` : `Edit · ${items.length} items`)}
                </p>
                <div className="mt-1 font-mono text-[11px] text-muted">
                  {lang === 'ru' ? `${items.length} пунктов · на основе v${s.baseVersion}` : `${items.length} items · based on v${s.baseVersion}`}
                </div>
              </Link>
            )
          })}
        </div>
      )}
      </div>
    </>
  )
}
