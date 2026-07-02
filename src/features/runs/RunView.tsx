'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, CircleCheckBig, RotateCcw, Square, SquareCheckBig, Trash2 } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { t } from '@/shared/i18n'
import { CopyButton } from '@/shared/ui/CopyButton'
import { abandonRun, finishRun, reopenRun, toggleStep, toggleSubtask } from './actions'

export interface RunStepVM {
  id: string
  n: number
  title: string
  desc: string
  command: string
  subtasks: string[]
  refs: { label: string; url?: string }[]
  done: boolean
  subtasksDone: number[]
}

export function RunView({
  runId,
  status,
  ordered,
  title,
  backHref,
  steps: initial,
  lang,
}: {
  runId: string
  status: 'active' | 'done' | 'abandoned'
  ordered: boolean
  title: string
  backHref: string
  steps: RunStepVM[]
  lang: Lang
}) {
  const ru = lang === 'ru'
  const [steps, setSteps] = useState(initial)
  const [, start] = useTransition()
  const done = steps.filter((s) => s.done).length
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0

  const patch = (i: number, p: Partial<RunStepVM>) => setSteps((xs) => xs.map((s, idx) => (idx === i ? { ...s, ...p } : s)))

  function toggle(i: number) {
    const s = steps[i]
    patch(i, { done: !s.done })
    start(() => toggleStep(runId, s.id))
  }
  function toggleSub(i: number, idx: number) {
    const s = steps[i]
    const has = s.subtasksDone.includes(idx)
    patch(i, { subtasksDone: has ? s.subtasksDone.filter((x) => x !== idx) : [...s.subtasksDone, idx] })
    start(() => toggleSubtask(runId, s.id, idx))
  }

  return (
    <div className="mx-auto w-full max-w-[760px] px-6 py-8">
      <Link href={backHref} className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft size={14} /> {backHref.replace(/^\//, '')}
      </Link>

      {/* Прогресс */}
      <div className="sticky top-[64px] z-10 mb-5 rounded-lg border border-border bg-surface/95 p-4 backdrop-blur">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-ink">{title}</div>
            <div className="text-[12.5px] text-ink-2">
              {status === 'done' ? t('runDone', lang) : `${done} / ${steps.length} · ${pct}%`}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {status === 'done' ? (
              <button
                type="button"
                onClick={() => start(() => reopenRun(runId))}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-[12.5px] text-ink hover:border-border-strong"
              >
                <RotateCcw size={13} /> {t('runReopen', lang)}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => start(() => finishRun(runId))}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-primary-fg"
              >
                <CircleCheckBig size={13} /> {t('runFinish', lang)}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (confirm(t('runAbandonConfirm', lang))) start(() => abandonRun(runId))
              }}
              title={t('runAbandon', lang)}
              className="grid h-8 w-8 place-items-center rounded-md text-muted hover:text-[var(--danger)]"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-[var(--ok)] transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Шаги */}
      <div className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <div
            key={s.id}
            className={`rounded-lg border p-4 transition-colors ${s.done ? 'border-[var(--ok)]/40 bg-[var(--ok)]/5' : 'border-border bg-surface'}`}
          >
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => toggle(i)}
                aria-label={s.done ? 'uncheck' : 'check'}
                className={`mt-0.5 shrink-0 ${s.done ? 'text-[var(--ok)]' : 'text-muted hover:text-ink'}`}
              >
                {s.done ? <SquareCheckBig size={20} /> : <Square size={20} />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  {ordered && <span className="font-mono text-[12px] text-muted">{s.n}</span>}
                  <span className={`text-[14.5px] font-semibold ${s.done ? 'text-ink-2 line-through' : 'text-ink'}`}>{s.title}</span>
                </div>
                {s.desc && <div className="mt-1 text-[13px] leading-snug text-ink-2">{s.desc}</div>}

                {s.command && (
                  <div className="mt-3 flex items-center gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 font-mono text-[12px] text-ink">
                    <span style={{ color: 'var(--accent)' }}>$</span>
                    <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{s.command}</span>
                    <CopyButton text={s.command} />
                  </div>
                )}

                {s.subtasks.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {s.subtasks.map((sub, idx) => {
                      const checked = s.subtasksDone.includes(idx)
                      return (
                        <li key={idx}>
                          <button
                            type="button"
                            onClick={() => toggleSub(i, idx)}
                            className="flex items-start gap-2 text-left text-[13px] text-ink-2"
                          >
                            <span className={`mt-0.5 shrink-0 ${checked ? 'text-[var(--ok)]' : 'text-muted'}`}>
                              {checked ? <Check size={14} /> : <Square size={14} />}
                            </span>
                            <span className={checked ? 'line-through opacity-70' : ''}>{sub}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}

                {s.refs.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {s.refs.map((r, idx) =>
                      r.url ? (
                        <a
                          key={idx}
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[11.5px] text-accent"
                        >
                          {r.label}
                        </a>
                      ) : (
                        <span key={idx} className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[11.5px] text-ink-2">
                          {r.label}
                        </span>
                      ),
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
