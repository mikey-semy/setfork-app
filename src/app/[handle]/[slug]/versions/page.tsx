import { notFound } from 'next/navigation'
import { Tag } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { getListMeta, getVersions } from '@/features/library/queries'
import { ListHeader } from '@/features/library/ListHeader'

export default async function VersionsPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>
}) {
  const { handle: owner, slug } = await params
  const lang = await getLang()
  const meta = await getListMeta(owner, slug)
  if (!meta) notFound()
  const versions = await getVersions(meta.id)

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="versions" />
      <div className="mx-auto w-full max-w-[820px] px-4 py-6">
        <div className="flex flex-col gap-2.5">
          {versions.map((v) => (
            <div key={v.id} className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4">
              <Tag size={16} className="mt-0.5 flex-shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[14px] font-semibold text-ink">v{v.version}</span>
                  {v.version === meta.currentVersion && (
                    <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-accent">
                      {t('currentVersion', lang)}
                    </span>
                  )}
                </div>
                {v.note && v.note !== 'seeded' && (
                  <div className="mt-1 text-[13px] text-ink-2">{v.note}</div>
                )}
              </div>
              <span className="flex-shrink-0 font-mono text-[11.5px] text-muted">
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
