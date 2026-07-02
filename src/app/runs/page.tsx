import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PlayCircle } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { EmptyState } from '@/shared/ui/EmptyState'
import { getUserRuns } from '@/features/runs/queries'

const STATUS = {
  active: { en: 'in progress', ru: 'в процессе', cls: 'text-[var(--accent)]' },
  done: { en: 'done', ru: 'завершён', cls: 'text-[var(--ok)]' },
  abandoned: { en: 'abandoned', ru: 'брошен', cls: 'text-muted' },
} as const

export default async function RunsPage() {
  const [session, lang] = await Promise.all([getSession(), getLang()])
  if (!session) redirect('/login')
  const runs = await getUserRuns(session.userId)
  const ru = lang === 'ru'

  return (
    <div className="mx-auto w-full max-w-[760px] px-6 py-8">
      <h1 className="mb-1 text-[18px] font-bold text-ink">{t('myRuns', lang)}</h1>
      <p className="mb-5 text-[13px] text-ink-2">{t('myRunsIntro', lang)}</p>

      {runs.length === 0 ? (
        <EmptyState
          icon={<PlayCircle size={36} strokeWidth={1.5} />}
          title={t('noRuns', lang)}
          action={{ href: '/explore', label: t('explore', lang) }}
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {runs.map((r) => {
            const st = STATUS[r.status]
            const pct = r.total ? Math.round((r.doneCount / r.total) * 100) : 0
            return (
              <Link
                key={r.id}
                href={`/runs/${r.id}`}
                className="rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-[14px] font-medium text-ink">{tr(r.title, lang)}</span>
                  <span className={`shrink-0 text-[12px] ${st.cls}`}>{ru ? st.ru : st.en}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-2">
                  <span className="font-mono text-muted">
                    {r.handle}/{r.slug} · v{r.version}
                  </span>
                  <span className="ml-auto">
                    {r.doneCount}/{r.total}
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-[var(--ok)]" style={{ width: `${pct}%` }} />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
