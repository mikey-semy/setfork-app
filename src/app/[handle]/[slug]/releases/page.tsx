import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, GitCompare, Tag } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { getListMeta, getVersions } from '@/features/library/queries'
import { ListHeader } from '@/features/library/ListHeader'
import { timeAgo } from '@/shared/ui/timeAgo'

// Служебные заметки версий — не показываем как «тело» релиза (это авто-подписи).
const BOILERPLATE_NOTES = new Set(['initial', 'edit', 'seeded', 'ai draft'])

export default async function ReleasesPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>
}) {
  const { handle: owner, slug } = await params
  const lang = await getLang()
  const meta = await getListMeta(owner, slug)
  if (!meta) notFound()

  // getVersions возвращает по убыванию version (новые сверху) — как «Releases» на GitHub.
  const versions = await getVersions(meta.id)
  const latestVersion = versions[0]?.version

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="versions" />
      <div className="mx-auto w-full max-w-[820px] px-4 py-6">
        {versions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-[13.5px] text-muted">
            {t('noReleases', lang)}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {versions.map((v) => {
              const note = v.note?.trim()
              const body = note && !BOILERPLATE_NOTES.has(note.toLowerCase()) ? note : null
              return (
                <div key={v.id} className="rounded-lg border border-border bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 font-mono text-[12px] font-semibold text-ink">
                      <Tag size={12} className="text-muted" /> v{v.version}
                    </span>
                    {v.version === latestVersion && (
                      <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-semibold text-ok">
                        {t('latest', lang)}
                      </span>
                    )}
                    <span className="font-mono text-[11.5px] text-muted">{timeAgo(v.createdAt, lang)}</span>
                  </div>

                  <div className="mt-2 text-[15px] font-semibold text-ink">{body ? body : `v${v.version}`}</div>

                  <div className="mt-3 flex flex-wrap items-center gap-4 text-[12.5px]">
                    {v.version > 1 && (
                      <Link
                        href={`/${owner}/${slug}/compare?from=${v.version - 1}&to=${v.version}`}
                        className="inline-flex items-center gap-1.5 text-ink-2 hover:text-accent"
                      >
                        <GitCompare size={13} /> {t('compareTitle', lang)}
                      </Link>
                    )}
                    <a
                      href={`/${owner}/${slug}/repo.bundle`}
                      className="inline-flex items-center gap-1.5 text-ink-2 hover:text-accent"
                    >
                      <Download size={13} /> {t('downloadBundle', lang)}
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
