import Link from 'next/link'
import { notFound } from 'next/navigation'
import { History } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { tr } from '@/shared/i18n'
import { timeAgo } from '@/shared/ui/timeAgo'
import { getListMeta } from '@/features/library/queries'
import { canViewList } from '@/features/library/access'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { ListHeader } from '@/features/library/ListHeader'
import { getListBlame } from '@/features/library/blame'

// «Blame» по шагам: видно, что давно не трогали, а что свежее. Автор версий
// пока не хранится — показываем версию/дату/note изменения.
export default async function BlamePage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle: owner, slug } = await params
  const lang = await getLang()
  const ru = lang === 'ru'
  const meta = await getListMeta(owner, slug)
  if (!meta) notFound()
  // Явная проверка видимости, а не побочный notFound() внутри ListHeader (хрупко):
  // приватный/черновой/снятый список не отдаёт blame по owner/slug.
  const session = await getSession()
  if (!canViewList(meta, { isOwner: meta.ownerId === session?.userId, isAdmin: isAdminHandle(session?.handle) })) notFound()
  const blame = await getListBlame(meta.id)
  if (!blame) notFound()
  const base = `/${owner}/${slug}`
  let section = ''

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="overview" />
      <div className="mx-auto w-full max-w-[900px] px-4 py-6">
        <h1 className="mb-1 flex items-center gap-2 text-[17px] font-bold text-ink">
          <History size={18} className="text-muted" /> Blame
        </h1>
        <p className="mb-4 text-[13px] text-ink-2">
          {ru
            ? 'В какой версии каждый шаг менялся в последний раз (по позиции) — видно устаревшие и свежие.'
            : 'Which version last changed each step (by position) — spot stale vs. fresh steps.'}
        </p>

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
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{tr(s.title, lang)}</span>
                  {s.note && <span className="hidden min-w-0 max-w-[220px] truncate text-[12px] text-muted sm:block">{s.note}</span>}
                  <Link
                    href={`${base}/versions`}
                    title={ru ? 'история версий' : 'version history'}
                    className={`shrink-0 rounded border px-1.5 font-mono text-[11px] ${
                      fresh ? 'border-[var(--accent)]/50 bg-[var(--accent-soft)] text-accent' : 'border-border bg-surface-2 text-ink-2'
                    }`}
                  >
                    v{s.lastVersion}
                  </Link>
                  <span className="w-[92px] shrink-0 text-right text-[11.5px] text-muted">{timeAgo(s.lastAt, lang)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
