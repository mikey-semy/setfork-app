import { buttonClass } from '@/shared/ui/button-style'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, Eye, FileText, GitCompare, Plus, Rss, Tag, Trash2 } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Markdown } from '@/shared/ui/Markdown'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { Badge } from '@/shared/ui/badge'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { timeAgo } from '@/shared/ui/timeAgo'
import { Tooltip } from '@/shared/ui/Tooltip'
import { UserLine } from '@/shared/ui/UserLine'
import { requireViewableMeta } from '@/features/library/guard'
import { isCollaborator } from '@/features/collab/queries'
import { countReleases, getLatestReleaseId, getReleases } from '@/features/releases/queries'
import { HistoryNav } from '@/widgets/HistoryNav'
import { deleteRelease } from '@/features/releases/actions'
import { PAGE } from '@/shared/ui/control'
import { cardClass } from '@/shared/ui/card-style'
import { Pagination } from '@/shared/ui/Pagination'
import { pageCount, pageFromParam, pageHref, pageWindow } from '@/shared/lib/paging'
import { IconButton } from '@/shared/ui/IconButton'
import { SectionLabel } from '@/shared/ui/SectionLabel'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('releasesLabel', lang)} · ${handle}/${slug}` }
}

export default async function ReleasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const [{ handle: owner, slug }, sp, lang, session] = await Promise.all([params, searchParams, getLang(), getSession()])
  const ru = lang === 'ru'
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const total = await countReleases(meta.id)
  const totalPages = pageCount(total)
  const page = pageFromParam(sp.page, totalPages)
  // «Последний» релиз спрашивается отдельно, а не ищется в показанной странице: попадись
  // на первой странице одни пред-релизы — метка уехала бы на вторую и встала не на тот.
  const [rels, latestId] = await Promise.all([getReleases(meta.id, pageWindow(page)), getLatestReleaseId(meta.id)])
  const canManage = !!session && (session.userId === meta.ownerId || (await isCollaborator(meta.id, session.userId)))
  const base = `/${owner}/${slug}`
  // Один тернарник на подпись: каждое повторение — отдельное нарушение правила про
  // двуязычные строки в коде.
  const newReleaseLabel = ru ? 'Новый релиз' : 'New release'

  return (
    <>
      <div className={PAGE}>
        <HistoryNav
          base={base}
          active="releases"
          canCompare={meta.currentVersion > 1}
          labels={{ commits: t('versionsTab', lang), releases: t('releasesLabel', lang), compare: t('compareTitle', lang) }}
        />
        <PageHeader
          size="section"
          title={t('releasesLabel', lang)}
          actions={
            <>
              <Tooltip label="Atom feed">
                <IconButton href={`${base}/releases.atom`} size="sm" variant="outline" label="Atom feed">
                  <Rss size={14} />
                </IconButton>
              </Tooltip>
              {canManage && (
                <Tooltip label={newReleaseLabel}>
                  <Link
                    href={`${base}/releases/new`}
                    aria-label={newReleaseLabel}
                    // Через примитив, а не рукописным `h-8`: высота обязана приходить из
                    // шкалы, иначе совпадёт с соседями только случайно.
                    className={buttonClass({ variant: 'primary' })}
                  >
                    <Plus size={13} />
                    <span className="max-sm:hidden">{newReleaseLabel}</span>
                  </Link>
                </Tooltip>
              )}
            </>
          }
        />

        {rels.length === 0 ? (
          <EmptyState hint={t('noReleases', lang)}>
            {canManage && (
              <div>
                <Link href={`${base}/releases/new`} className="text-accent hover:underline">
                  {ru ? 'Опубликовать первый релиз из версии' : 'Publish the first release from a version'}
                </Link>
              </div>
            )}
            <div className="text-body-sm">
              <Link href={`${base}/versions`} className="text-ink-2 hover:text-accent">
                {ru ? 'Все версии — во вкладке «Версии»' : 'All versions live under the Versions tab'}
              </Link>
            </div>
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            {rels.map((r) => (
              <div key={r.id} className={cardClass()}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="px-2.5 font-mono text-body-sm text-ink">
                    <Tag size={12} className="text-muted" /> {r.tag}
                  </Badge>
                  {r.id === latestId && <Badge variant="ok">{t('latest', lang)}</Badge>}
                  {r.prerelease && <Badge variant="warn">{t('preRelease', lang)}</Badge>}
                  <UserLine handle={r.authorHandle} avatarUrl={r.authorAvatarUrl} size="xs" />
                  <span className="font-mono text-caption text-muted">{timeAgo(r.createdAt, lang)} · v{r.version}</span>
                  {canManage && (
                    <form action={deleteRelease.bind(null, r.id)} className="ml-auto">
                      <SubmitButton variant="danger" size="xs" aria-label={ru ? 'Удалить релиз' : 'Delete release'}>
                        <Trash2 size={13} />
                      </SubmitButton>
                    </form>
                  )}
                </div>

                <div className="mt-2 text-title font-semibold text-ink [overflow-wrap:anywhere]">{r.title || r.tag}</div>
                {r.notes && (
                  <div className="mt-2 border-t border-border/60 pt-2">
                    <Markdown refBase={`${base}/issues`}>{r.notes}</Markdown>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border/60 pt-2.5 text-body-sm">
                  <SectionLabel as="span">Assets</SectionLabel>
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
        <Pagination page={page} totalPages={totalPages} makeHref={pageHref(`${base}/releases`, sp)} lang={lang} />
      </div>
    </>
  )
}
