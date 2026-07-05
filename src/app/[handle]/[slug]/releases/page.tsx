import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, FileText, GitCompare, Plus, Rss, Tag, Trash2 } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { Markdown } from '@/shared/ui/Markdown'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { timeAgo } from '@/shared/ui/timeAgo'
import { getListMeta } from '@/features/library/queries'
import { isCollaborator } from '@/features/collab/queries'
import { ListHeader } from '@/features/library/ListHeader'
import { getReleases } from '@/features/releases/queries'
import { deleteRelease } from '@/features/releases/actions'

export default async function ReleasesPage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle: owner, slug } = await params
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const ru = lang === 'ru'
  const meta = await getListMeta(owner, slug)
  if (!meta) notFound()
  const rels = await getReleases(meta.id)
  const canManage = !!session && (session.userId === meta.ownerId || (await isCollaborator(meta.id, session.userId)))
  const base = `/${owner}/${slug}`

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="versions" />
      <div className="mx-auto w-full max-w-[820px] px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-[16px] font-bold text-ink">Releases</h1>
          <div className="flex items-center gap-2">
            <a href={`${base}/releases.atom`} title="Atom feed" className="rounded-md border border-border p-1.5 text-muted hover:text-ink">
              <Rss size={14} />
            </a>
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
                {ru ? 'Все версии — во вкладке Versions' : 'All versions live under the Versions tab'}
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {rels.map((r, i) => (
              <div key={r.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 font-mono text-[12px] font-semibold text-ink">
                    <Tag size={12} className="text-muted" /> {r.tag}
                  </span>
                  {i === 0 && <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-semibold text-ok">{t('latest', lang)}</span>}
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
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">Assets</span>
                  <a href={`${base}/export?format=md`} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-accent">
                    <FileText size={13} /> markdown
                  </a>
                  <a href={`${base}/export?format=html`} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-accent">
                    <FileText size={13} /> html
                  </a>
                  <a href={`${base}/repo.bundle`} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-accent">
                    <Download size={13} /> {t('downloadBundle', lang)}
                  </a>
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
