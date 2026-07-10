import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GitCompare, Tag } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { requireViewableMeta } from '@/features/library/guard'
import { listStore } from '@/features/library/list-store'
import { ListHeader } from '@/widgets/ListHeader'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  return { title: `Versions · ${handle}/${slug}` }
}

export default async function VersionsPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>
}) {
  const [{ handle: owner, slug }, lang] = await Promise.all([params, getLang()])
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const versions = await listStore.listVersions(meta.id)

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="versions" />
      <div className="mx-auto w-full max-w-[820px] px-4 py-6">
        {meta.currentVersion > 1 && (
          <Link
            href={`/${owner}/${slug}/compare`}
            className="mb-4 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3.5 py-2 text-[13px] font-semibold text-ink hover:border-border-strong"
          >
            <GitCompare size={15} /> {t('compareTitle', lang)}
          </Link>
        )}
        <div className="flex flex-col gap-2.5">
          {versions.map((v) => (
            <div key={v.id} className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4">
              <Tag size={16} className="mt-0.5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[14px] font-semibold text-ink">v{v.version}</span>
                  {v.version === meta.currentVersion && (
                    <span className="rounded-full bg-(--accent-soft) px-2 py-0.5 text-[11px] font-semibold text-accent">
                      {t('currentVersion', lang)}
                    </span>
                  )}
                  {v.version > 1 && (
                    <Link
                      href={`/${owner}/${slug}/compare?from=${v.version - 1}&to=${v.version}`}
                      className="inline-flex items-center gap-1 text-[11.5px] text-ink-2 hover:text-accent"
                    >
                      <GitCompare size={12} /> {t('compareVersions', lang)} v{v.version - 1}
                    </Link>
                  )}
                </div>
                {v.note && v.note !== 'seeded' && (
                  <div className="mt-1 text-[13px] text-ink-2">{v.note}</div>
                )}
              </div>
              <span className="shrink-0 font-mono text-[11.5px] text-muted">
                {new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                }).format(new Date(v.createdAt))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
