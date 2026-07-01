import Link from 'next/link'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { TopNav } from '@/widgets/TopNav'
import { getUserRuns } from '@/features/runs/queries'
import { getTemplateDetail } from '@/features/library/queries'

export default async function RunsPage() {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const runs = session ? await getUserRuns(session.userId) : []

  return (
    <main className="min-h-screen bg-canvas px-4 py-10 sm:px-10">
      <div className="mx-auto max-w-[1120px] overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        <TopNav lang={lang} user={session} active="runs" />
        <div className="px-6 py-5">
          <h1 className="mb-4 text-[15px] font-semibold text-ink">{t('runs', lang)}</h1>
          {!session ? (
            <SignInHint lang={lang} />
          ) : runs.length === 0 ? (
            <Empty text={t('emptyRuns', lang)} />
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {runs.map((r) => (
                <Link
                  key={r.id}
                  href={`/${r.ownerHandle}/${r.slug}`}
                  className="flex items-center gap-4 py-3.5 hover:opacity-80"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px]">
                      <span className="text-ink-2">{r.ownerHandle}/</span>
                      <span className="font-semibold text-accent">{r.slug}</span>
                    </div>
                    <div className="text-[12.5px] text-ink-2">{tr(r.title, lang)}</div>
                  </div>
                  <span className="font-mono text-[12px] text-muted">v{r.version}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      r.status === 'done'
                        ? 'bg-[var(--accent-soft)] text-accent'
                        : 'bg-surface-2 text-ink-2'
                    }`}
                  >
                    {r.status === 'done' ? t('done', lang) : `${r.doneCount}`}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="py-16 text-center text-[13.5px] text-muted">{text}</div>
}

function SignInHint({ lang }: { lang: 'en' | 'ru' }) {
  return (
    <div className="py-16 text-center text-[13.5px] text-muted">
      {t('loginRequired', lang)}{' '}
      <Link href="/login" className="font-semibold text-accent">
        {t('signIn', lang)}
      </Link>
    </div>
  )
}
