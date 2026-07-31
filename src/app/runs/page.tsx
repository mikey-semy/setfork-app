import Link from 'next/link'
import { PlayCircle, ListChecks } from 'lucide-react'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr, type Lang } from '@/shared/i18n'
import { timeAgo } from '@/shared/ui/timeAgo'
import { EmptyState } from '@/shared/ui/EmptyState'
import { getUserRuns, type UserRunRow } from '@/features/runs/queries'
import { DeleteRunButton } from '@/features/runs/DeleteRunButton'

export const metadata = { title: 'Runs' }

export default async function MyRunsPage() {
  const session = await requireSession()
  const [lang, runs] = await Promise.all([getLang(), getUserRuns(session.userId)])

  const active = runs.filter((r) => r.status === 'active')
  const done = runs.filter((r) => r.status === 'done')
  const abandoned = runs.filter((r) => r.status === 'abandoned')

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-8">
      <h1 className="mb-5 flex items-center gap-2 text-[18px] font-bold text-ink">
        <PlayCircle size={18} className="text-accent" /> {t('myRuns', lang)}
      </h1>

      {runs.length === 0 ? (
        <EmptyState icon={<ListChecks size={34} strokeWidth={1.5} />} title={t('noRunsYet', lang)} />
      ) : (
        <div className="flex flex-col gap-6">
          <Section label={t('runsInProgress', lang)} rows={active} lang={lang} />
          <Section label={t('runsCompleted', lang)} rows={done} lang={lang} />
          <Section label={t('runsAbandoned', lang)} rows={abandoned} lang={lang} muted />
        </div>
      )}
    </div>
  )
}

function Section({ label, rows, lang, muted }: { label: string; rows: UserRunRow[]; lang: Lang; muted?: boolean }) {
  if (rows.length === 0) return null
  return (
    <section>
      <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">
        {label} · {rows.length}
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <RunCard key={r.id} r={r} lang={lang} muted={muted} />
        ))}
      </div>
    </section>
  )
}

function RunCard({ r, lang, muted }: { r: UserRunRow; lang: Lang; muted?: boolean }) {
  const pct = r.total > 0 ? Math.round((r.doneCount / r.total) * 100) : 0
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong ${muted ? 'opacity-70' : ''}`}
    >
      <Link href={`/runs/${r.id}`} className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-ink">{tr(r.title, lang)}</span>
          <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2">v{r.version}</span>
          {r.status === 'failed' && <span className="rounded border border-danger/40 px-1.5 py-0.5 text-[10.5px] font-medium text-danger">{t('runFailed', lang)}</span>}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-muted">
          {r.handle}/{r.slug} · {timeAgo(r.updatedAt, lang)}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-ok transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 font-mono text-[11px] text-ink-2">
            {r.doneCount}/{r.total}
          </span>
        </div>
      </Link>
      <Link
        href={`/runs/${r.id}`}
        className="shrink-0 rounded-md border border-border px-3 py-1.5 text-[12.5px] font-semibold text-ink hover:border-border-strong"
      >
        {r.status === 'active' ? t('runResume', lang) : t('runOpen', lang)}
      </Link>
      <DeleteRunButton runId={r.id} confirmText={t('runDeleteConfirm', lang)} label={t('runDelete', lang)} lang={lang} />
    </div>
  )
}
