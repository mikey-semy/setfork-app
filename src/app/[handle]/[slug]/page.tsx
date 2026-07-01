import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Clock, ExternalLink, GitFork, GitPullRequest, Image as ImageIcon, Pencil, Sparkles } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr, type LocaleText } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { CopyButton } from '@/shared/ui/CopyButton'
import { getOpenSuggestionCount, getTemplateDetail, isLiked } from '@/features/library/queries'
import { forkTemplate } from '@/features/library/actions'
import { LikeButton } from '@/features/library/LikeButton'

export default async function ListPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>
}) {
  const { handle: owner, slug } = await params
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const detail = await getTemplateDetail(owner, slug)
  if (!detail) notFound()
  const { tpl, currentVersion, steps } = detail
  const liked = session ? await isLiked(tpl.id, session.userId) : false
  const isOwner = session?.userId === tpl.ownerId
  const suggCount = await getOpenSuggestionCount(tpl.id)
  const forkBound = forkTemplate.bind(null, tpl.id)

  return (
    <div className="mx-auto w-full max-w-[780px] px-4 py-8">
      <Link href="/explore" className="mb-4 inline-flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> {t('backToExplore', lang)}
      </Link>

      {/* Шапка эталона */}
      <div className="flex items-start gap-3.5">
        <Link href={`/${tpl.owner.handle}`} className="flex-shrink-0">
          <Avatar handle={tpl.owner.handle} avatarUrl={tpl.owner.avatarUrl} size={44} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[20px] font-bold">
              <Link href={`/${tpl.owner.handle}`} className="text-ink-2 hover:text-accent">
                {tpl.owner.handle}
              </Link>
              <span className="text-ink-2">/</span>
              <span className="text-ink">{tpl.slug}</span>
            </h1>
            <span className="rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[11px] text-accent">
              v{currentVersion?.version ?? tpl.currentVersion}
            </span>
            {tpl.origin === 'forked' && (
              <span className="font-mono text-[10.5px] text-muted">{t('forkedFrom', lang)}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
            <span>
              {t('maintainedBy', lang)}{' '}
              <Link href={`/${tpl.owner.handle}`} className="text-ink-2 hover:text-accent">
                {tpl.owner.name ?? tpl.owner.handle}
              </Link>
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock size={12} /> {t('updated', lang)}{' '}
              {new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', { month: 'short', day: 'numeric' }).format(
                new Date(tpl.updatedAt),
              )}
            </span>
          </div>
        </div>
      </div>

      {tr(tpl.desc, lang) && <p className="mt-4 text-[14px] leading-relaxed text-ink-2">{tr(tpl.desc, lang)}</p>}

      {tpl.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tpl.tags.map((tag) => (
            <Link
              key={tag}
              href={`/explore?tag=${encodeURIComponent(tag)}`}
              className="rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[12px] font-medium text-accent hover:underline"
            >
              {tag}
            </Link>
          ))}
        </div>
      )}

      {/* Действия */}
      <div className="mt-4 flex flex-wrap items-center gap-2.5 border-b border-border pb-5">
        {session ? (
          <LikeButton templateId={tpl.id} liked={liked} count={tpl.starsCount} label={t('like', lang)} />
        ) : (
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3.5 py-2 text-[13px] font-semibold text-ink hover:border-border-strong"
          >
            ♥ {t('like', lang)} <span className="font-mono text-[12px] text-muted">{tpl.starsCount}</span>
          </Link>
        )}
        <form action={forkBound}>
          <button className="inline-flex items-center gap-2 rounded-md border border-border px-3.5 py-2 text-[13px] font-semibold text-ink hover:border-border-strong">
            <GitFork size={14} /> {t('fork', lang)}{' '}
            <span className="font-mono text-[12px] text-muted">{tpl.forksCount}</span>
          </button>
        </form>

        {isOwner ? (
          <Link
            href={`/${owner}/${slug}/edit`}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3.5 py-2 text-[13px] font-semibold text-ink hover:border-border-strong"
          >
            <Pencil size={14} /> {t('edit', lang)}
          </Link>
        ) : (
          <Link
            href={`/${owner}/${slug}/suggest`}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3.5 py-2 text-[13px] font-semibold text-ink hover:border-border-strong"
          >
            <Pencil size={14} /> {t('suggestEdit', lang)}
          </Link>
        )}

        <Link
          href={`/${owner}/${slug}/suggestions`}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-2 text-[13px] font-medium text-ink-2 hover:text-ink"
        >
          <GitPullRequest size={14} /> {t('suggestions', lang)}
          <span className="font-mono text-[12px] text-muted">{suggCount}</span>
        </Link>
      </div>

      {tpl.origin === 'ai_draft' && (
        <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3 text-[13px] text-accent">
          <Sparkles size={15} className="flex-shrink-0" /> {t('aiVerifyHint', lang)}
        </div>
      )}

      {/* Содержимое-эталон */}
      <div className="mt-5 flex flex-col gap-3">
        {steps.map((s) => {
          const subs = (s.subtasks as LocaleText[]).map((x) => tr(x, lang)).filter(Boolean)
          const refs = (s.refs as { label: LocaleText; url?: string }[]).map((x) => ({
            label: tr(x.label, lang),
            url: x.url,
          }))
          return (
            <div key={s.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex gap-3">
                <span className="mt-0.5 font-mono text-[13px] text-muted">{s.n}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-semibold text-ink">{tr(s.title, lang)}</div>
                  {tr(s.desc, lang) && (
                    <div className="mt-1 text-[13px] leading-snug text-ink-2">{tr(s.desc, lang)}</div>
                  )}

                  {s.hasImage && (
                    <div className="mt-3 flex h-[120px] flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface-2 text-muted">
                      <ImageIcon size={22} strokeWidth={1.5} />
                      <span className="text-[11.5px]">{t('screenshot', lang)}</span>
                    </div>
                  )}

                  {s.command && (
                    <div className="mt-3 flex items-center gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 font-mono text-[12px] text-ink">
                      <span style={{ color: 'var(--accent)' }}>$</span>
                      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{s.command}</span>
                      <CopyButton text={s.command} />
                    </div>
                  )}

                  {subs.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {subs.map((label, i) => (
                        <li key={i} className="flex gap-2 text-[13px] text-ink-2">
                          <span className="text-muted">–</span>
                          {label}
                        </li>
                      ))}
                    </ul>
                  )}

                  {refs.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {refs.map((r, i) => {
                        const cls =
                          'inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[11.5px] text-accent'
                        return r.url ? (
                          <a key={i} href={r.url} target="_blank" rel="noreferrer" className={cls}>
                            <ExternalLink size={11} /> {r.label}
                          </a>
                        ) : (
                          <span key={i} className={cls}>
                            <ExternalLink size={11} /> {r.label}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
