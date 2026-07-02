import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink, GitFork, Sparkles, Star, Tag } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t, tr, type LocaleText } from '@/shared/i18n'
import { CopyButton } from '@/shared/ui/CopyButton'
import { getStepPreviews, getTemplateDetail } from '@/features/library/queries'
import { ListHeader } from '@/features/library/ListHeader'

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'k'
  return String(n)
}

export default async function ListPage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle: owner, slug } = await params
  const lang = await getLang()
  const detail = await getTemplateDetail(owner, slug)
  if (!detail) notFound()
  const { tpl, currentVersion, steps } = detail
  const viewer = await getSession()
  const isOwnerOrAdmin = viewer?.userId === tpl.ownerId || isAdminHandle(viewer?.handle)
  if (tpl.visibility === 'private' && viewer?.userId !== tpl.ownerId) notFound()
  if (tpl.moderation === 'hidden' && !isOwnerOrAdmin) notFound()
  // Резолвим скриншоты шагов (storage_key → подписанный imgproxy-URL), ключ = id шага.
  const previews = await getStepPreviews(steps, 'rs:fit:1400:1400')
  const stepImages: Record<string, string> = Object.fromEntries(
    steps.filter((s) => s.imageKey && previews[s.imageKey]).map((s) => [s.id, previews[s.imageKey as string]]),
  )

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="overview" />

      <div className="mx-auto w-full max-w-[1180px] px-4 py-6">
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Основное: содержимое-эталон */}
          <main className="min-w-0 flex-1">
            {tpl.origin === 'ai_draft' && (
              <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3 text-[13px] text-accent">
                <Sparkles size={15} className="flex-shrink-0" /> {t('aiVerifyHint', lang)}
              </div>
            )}

            <div className="flex flex-col gap-3">
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
                        {stepImages[s.id] && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={stepImages[s.id]}
                            alt={t('screenshot', lang)}
                            className="mt-3 max-h-[420px] w-auto rounded-lg border border-border"
                          />
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
          </main>

          {/* About-сайдбар */}
          <aside className="flex-shrink-0 lg:w-[300px]">
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">
                {t('about', lang)}
              </div>
              {tr(tpl.desc, lang) && <p className="text-[13.5px] leading-relaxed text-ink-2">{tr(tpl.desc, lang)}</p>}
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
              <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3 text-[13px] text-ink-2">
                <span className="inline-flex items-center gap-2">
                  <Star size={14} /> <b className="text-ink">{fmt(tpl.starsCount)}</b> stars
                </span>
                <span className="inline-flex items-center gap-2">
                  <GitFork size={14} /> <b className="text-ink">{fmt(tpl.forksCount)}</b> forks
                </span>
                <Link
                  href={`/${owner}/${slug}/versions`}
                  className="inline-flex items-center gap-2 hover:text-accent"
                >
                  <Tag size={14} /> {t('versionsTab', lang)}:{' '}
                  <b className="text-ink">v{currentVersion?.version ?? tpl.currentVersion}</b>
                </Link>
                <span>
                  {t('maintainedBy', lang)}{' '}
                  <Link href={`/${tpl.owner.handle}`} className="text-ink-2 hover:text-accent">
                    {tpl.owner.name ?? tpl.owner.handle}
                  </Link>
                </span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}
