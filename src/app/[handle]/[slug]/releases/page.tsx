import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, Eye, FileText, GitCompare, Plus, Rss, Tag, Trash2 } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { Markdown } from '@/shared/ui/Markdown'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { Badge } from '@/shared/ui/badge'
import { timeAgo } from '@/shared/ui/timeAgo'
import { Tooltip } from '@/shared/ui/Tooltip'
import { requireViewableMeta } from '@/features/library/guard'
import { isCollaborator } from '@/features/collab/queries'
import { getReleases } from '@/features/releases/queries'
import { HistoryNav } from '@/widgets/HistoryNav'
import { deleteRelease } from '@/features/releases/actions'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  return { title: `Releases · ${handle}/${slug}` }
}

export default async function ReleasesPage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle: owner, slug }, lang, session] = await Promise.all([params, getLang(), getSession()])
  const ru = lang === 'ru'
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const rels = await getReleases(meta.id)
  // «Последняя» = первый НЕ пред-релиз (rels новые сверху), как GitHub.
  const latestId = rels.find((r) => !r.prerelease)?.id
  const canManage = !!session && (session.userId === meta.ownerId || (await isCollaborator(meta.id, session.userId)))
  const base = `/${owner}/${slug}`

  return (
    <>
      <div className="mx-auto w-full max-w-[820px] px-4 py-6">
        <HistoryNav
          base={base}
          active="releases"
          canCompare={meta.currentVersion > 1}
          labels={{ commits: t('versionsTab', lang), releases: t('releasesLabel', lang), compare: t('compareTitle', lang) }}
        />
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-[16px] font-bold text-ink">{t('releasesLabel', lang)}</h1>
          <div className="flex items-center gap-2">
            <Tooltip label="Atom feed">
              <a href={`${base}/releases.atom`} className="rounded-md border border-border p-1.5 text-muted hover:text-ink">
                <Rss size={14} />
              </a>
            </Tooltip>
            {canManage && (
              <Link
                href={`${base}/releases/new`}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-fg"
              >
                <Plus size={13} /> {ru ? 'Новый релиз' : 'New release'}
              </Link>
            )}
          </div>
        </div>

        {rels.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-[13.5px] text-muted">
            {t('noReleases', lang)}
            {canManage && (
              <div className="mt-2">
                <Link href={`${base}/releases/new`} className="text-accent hover:underline">
                  {ru ? 'Опубликовать первый релиз из версии' : 'Publish the first release from a version'}
                </Link>
              </div>
            )}
            <div className="mt-2 text-[12.5px]">
              <Link href={`${base}/versions`} className="text-ink-2 hover:text-accent">
                {ru ? 'Все версии — во вкладке «Версии»' : 'All versions live under the Versions tab'}
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {rels.map((r) => (
              <div key={r.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="px-2.5 font-mono text-[12px] text-ink">
                    <Tag size={12} className="text-muted" /> {r.tag}
                  </Badge>
                  {r.id === latestId && <Badge variant="ok">{t('latest', lang)}</Badge>}
                  {r.prerelease && (
                    <span className="rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[11px] font-semibold text-warn">
                      {t('preRelease', lang)}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
                    <Avatar handle={r.authorHandle} avatarUrl={r.authorAvatarUrl} size={16} />
                    <Link href={`/${r.authorHandle}`} className="hover:text-accent">{r.authorHandle}</Link>
                  </span>
                  <span className="font-mono text-[11.5px] text-muted">{timeAgo(r.createdAt, lang)} · v{r.version}</span>
                  {canManage && (
                    <form action={deleteRelease.bind(null, r.id)} className="ml-auto">
                      <SubmitButton className="rounded p-1 text-muted hover:bg-danger/10 hover:text-danger" aria-label={ru ? 'Удалить релиз' : 'Delete release'}>
                        <Trash2 size={13} />
                      </SubmitButton>
                    </form>
                  )}
                </div>

                <div className="mt-2 text-[16px] font-semibold text-ink">{r.title || r.tag}</div>
                {r.notes && (
                  <div className="mt-2 border-t border-border/60 pt-2">
                    <Markdown refBase={`${base}/issues`}>{r.notes}</Markdown>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border/60 pt-2.5 text-[12.5px]">
                  <span className="text-[10.5px] font-semibold uppercase tracking-widest text-muted">Assets</span>
                  <a href={`${base}/export?format=md`} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-accent">
                    <FileText size={13} /> markdown
                  </a>
                  <a href={`${base}/export?format=html`} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-accent">
                    <FileText size={13} /> html
                  </a>
                  <a href={`${base}/repo.bundle`} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-accent">
                    <Download size={13} /> {t('downloadBundle', lang)}
                  </a>
                  {/* Содержимое опубликованной версии: ?v=N (текущую страница отдаёт как есть). */}
                  <Link href={`${base}?v=${r.version}`} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-accent">
                    <Eye size={13} /> {t('viewVersion', lang)}
                  </Link>
                  {r.version > 1 && (
                    <Link href={`${base}/compare?from=${r.version - 1}&to=${r.version}`} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-accent">
                      <GitCompare size={13} /> {t('compareTitle', lang)}
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
