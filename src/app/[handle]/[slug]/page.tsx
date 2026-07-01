import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Clock, GitFork, Play } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr, type LocaleText } from '@/shared/i18n'
import type { Step } from '@/shared/db'
import { getTemplateDetail } from '@/features/library/queries'
import { getActiveRun } from '@/features/runs/queries'
import { forkTemplate, startRun } from '@/features/runs/actions'
import { RunView } from '@/features/runs/RunView'
import type { RunStepData } from '@/features/runs/RunStep'

export default async function TemplatePage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>
}) {
  const { handle: owner, slug } = await params
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const detail = await getTemplateDetail(owner, slug)
  if (!detail) notFound()
  const { tpl, currentVersion, steps } = detail

  const active = session ? await getActiveRun(tpl.id, session.userId) : null
  const total = steps.length
  const doneCount = active ? active.run.doneCount : 0
  const pct = total ? Math.round((doneCount / total) * 100) : 0

  const runSteps: RunStepData[] = active
    ? steps.map((s) => {
        const st = active.byStep.get(s.id)
        return {
          id: s.id,
          n: s.n,
          title: tr(s.title, lang),
          desc: tr(s.desc, lang),
          command: s.command,
          hasImage: s.hasImage,
          subtasks: (s.subtasks as LocaleText[]).map((x) => tr(x, lang)),
          refs: (s.refs as { label: LocaleText; url?: string }[]).map((x) => ({
            label: tr(x.label, lang),
            url: x.url,
          })),
          status: (st?.status ?? 'todo') as 'todo' | 'cur' | 'done',
          note: st?.note ?? '',
          subtasksDone: (st?.subtasksDone as number[]) ?? [],
        }
      })
    : []

  const startBound = startRun.bind(null, owner, slug)
  const forkBound = forkTemplate.bind(null, tpl.id)

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-8">
        <Link href="/explore" className="mb-4 inline-flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink">
          <ArrowLeft size={15} /> {t('backToExplore', lang)}
        </Link>

        <div className="overflow-hidden rounded-xl border border-border bg-surface-2">
          {/* Заголовок + версия + история + прогресс */}
          <div className="px-5 pb-3.5 pt-5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[15px]">
                <Link href={`/${tpl.owner.handle}`} className="text-ink-2 hover:text-accent">
                  {tpl.owner.handle}
                </Link>
                <span className="text-ink-2">/</span>
                <span className="font-semibold text-ink">{tpl.slug}</span>
              </span>
              <span className="rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[11px] text-accent">
                v{currentVersion?.version ?? tpl.currentVersion}
              </span>
              {tpl.origin === 'forked' && (
                <span className="font-mono text-[10.5px] text-muted">{t('forkedFrom', lang)}</span>
              )}
              <span className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
                <Clock size={14} /> {t('history', lang)}
              </span>
            </div>
            <div className="mt-3.5 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-ink transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="font-mono text-[12px] text-ink-2">
                {doneCount}/{total} · {pct}%
              </span>
            </div>
          </div>

          {/* Тело: прогон / превью / CTA */}
          <div className="flex flex-col px-3.5 pb-0.5 pt-1.5">
            {active ? (
              <RunView runId={active.run.id} steps={runSteps} lang={lang} />
            ) : (
              <div className="px-1">
                <ReadonlySteps lang={lang} steps={steps} />
                {session ? (
                  <form action={startBound} className="my-3">
                    <button className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-[14px] font-semibold text-primary-fg">
                      <Play size={15} /> {t('runIt', lang)}
                    </button>
                  </form>
                ) : (
                  <div className="my-3 rounded-md border border-border bg-surface px-4 py-3 text-center text-[13px] text-ink-2">
                    {t('loginRequired', lang)}{' '}
                    <Link href="/login" className="font-semibold text-accent">
                      {t('signIn', lang)}
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Футер: состояние + форк */}
          <div className="mx-4 mb-4 mt-1 flex justify-between border-t border-border pt-3 text-[11.5px] text-muted">
            <span>
              {t('stateSaved', lang)} v{active ? active.run.version : (currentVersion?.version ?? tpl.currentVersion)}
            </span>
            <form action={forkBound}>
              <button className="inline-flex items-center gap-1 text-accent">
                <GitFork size={12} /> {t('forkTemplate', lang)}
              </button>
            </form>
          </div>
        </div>
      </div>
  )
}

function ReadonlySteps({ lang, steps }: { lang: 'en' | 'ru'; steps: Step[] }) {
  return (
    <div className="flex flex-col gap-2 py-2">
      {steps.map((s) => (
        <div key={s.id} className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3.5">
          <span className="mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border-[1.5px] border-muted" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium text-ink">
              {s.n}. {tr(s.title, lang)}
            </div>
            <div className="mt-1 truncate text-[12.5px] text-ink-2">{tr(s.desc, lang)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
