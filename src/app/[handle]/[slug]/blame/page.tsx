import Link from 'next/link'
import { notFound } from 'next/navigation'
import { History } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { timeAgo } from '@/shared/ui/timeAgo'
import { Tooltip } from '@/shared/ui/Tooltip'
import { PageHeader } from '@/shared/ui/PageHeader'
import { requireViewableMeta } from '@/features/library/guard'
import { getListBlame } from '@/features/library/blame'

// «Blame» по шагам: видно, что давно не трогали, а что свежее. Автор версий
// пока не хранится — показываем версию/дату/note изменения.
export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  return { title: `Blame · ${handle}/${slug}` }
}

export default async function BlamePage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle: owner, slug }, lang] = await Promise.all([params, getLang()])
  // requireViewableMeta = загрузка + проверка видимости атомарно (не хрупкий сайд-эффект
  // ListHeader): приватный/черновой/снятый список не отдаёт blame по owner/slug.
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const blame = await getListBlame(meta.id)
  if (!blame) notFound()
  const base = `/${owner}/${slug}`
  let section = ''

  return (
    <>
      <div className="mx-auto w-full max-w-[900px] px-4 py-6">
        <PageHeader icon={<History size={18} className="text-muted" />} title={t('blameTitle', lang)} subtitle={t('blameHint', lang)} />

        <div className="divide-y divide-border rounded-lg border border-border bg-surface">
          {blame.steps.map((s) => {
            const sec = tr(s.section, lang)
            const showSec = sec && sec !== section
            section = sec || section
            const fresh = s.lastVersion === blame.currentVersion
            return (
              <div key={s.n}>
                {showSec && <div className="bg-surface-2 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{sec}</div>}
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-6 shrink-0 text-right font-mono text-[11px] text-muted">{s.n}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{tr(s.title, lang)}</span>
                  {s.note && <span className="hidden min-w-0 max-w-[220px] truncate text-[12.5px] text-muted sm:block">{s.note}</span>}
                  <Tooltip label={t('versionHistory', lang)}>
                    <Link
                      href={`${base}/versions`}
                      className={`shrink-0 rounded-md border px-1.5 font-mono text-[11px] ${
                        fresh ? 'border-(--accent)/50 bg-(--accent-soft) text-accent' : 'border-border bg-surface-2 text-ink-2'
                      }`}
                    >
                      v{s.lastVersion}
                    </Link>
                  </Tooltip>
                  <span className="w-[92px] shrink-0 text-right text-[11px] text-muted">{timeAgo(s.lastAt, lang)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
