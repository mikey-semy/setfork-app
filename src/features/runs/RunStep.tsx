'use client'

import { useState, useTransition } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, Image as ImageIcon, ExternalLink } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { markStepDone, saveNote, toggleSubtask } from './actions'

export interface RunStepData {
  id: string
  n: number
  title: string
  desc: string
  command: string
  hasImage: boolean
  subtasks: string[]
  refs: { label: string; url?: string }[]
  status: 'todo' | 'cur' | 'done'
  note: string
  subtasksDone: number[]
}

export function RunStep({
  runId,
  step,
  lang,
  compact,
  open,
  onToggle,
}: {
  runId: string
  step: RunStepData
  lang: Lang
  compact: boolean
  open: boolean
  onToggle: () => void
}) {
  const [pending, start] = useTransition()
  const [note, setNote] = useState(step.note)
  const done = new Set(step.subtasksDone)
  const isCur = step.status === 'cur'
  const isDone = step.status === 'done'

  function copyCmd() {
    try {
      navigator.clipboard?.writeText(step.command)
    } catch {
      /* noop */
    }
  }

  return (
    <div
      className="mb-2 overflow-hidden rounded-lg border transition-colors"
      style={{
        borderColor: isCur ? 'var(--cur)' : 'var(--border)',
        background: isCur ? 'var(--accent-soft)' : 'var(--surface)',
      }}
    >
      <div className="flex cursor-pointer items-start gap-3 p-3.5" onClick={onToggle}>
        <span
          className="mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full text-[11px]"
          style={
            isDone
              ? { background: 'var(--cur)', color: 'var(--primary-fg)' }
              : { border: `${isCur ? 2 : 1.5}px solid ${isCur ? 'var(--cur)' : 'var(--muted)'}` }
          }
        >
          {isDone && <Check size={12} />}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={`text-[14px] font-semibold leading-tight ${isDone ? 'text-muted line-through' : 'text-ink'}`}
          >
            {step.n}. {step.title}
          </div>
          {!compact && (
            <div className={`mt-1 text-[12.5px] leading-snug text-ink-2 ${open ? '' : 'truncate'}`}>
              {step.desc}
            </div>
          )}
        </div>
        {isCur && (
          <span
            className="mt-0.5 flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ background: 'var(--cur)', color: 'var(--primary-fg)' }}
          >
            {t('now', lang)}
          </span>
        )}
        {isDone && (
          <span className="mt-0.5 flex-shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted">
            {t('done', lang)}
          </span>
        )}
        <span className="mt-1 flex-shrink-0 text-muted">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </div>

      {open && (
        <div className="px-4 pb-4 pl-[45px]">
          {step.hasImage && (
            <div className="mb-3.5 mt-1.5 flex h-[130px] flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface-2 text-muted">
              <ImageIcon size={24} strokeWidth={1.5} />
              <span className="text-[11.5px]">{t('screenshot', lang)}</span>
            </div>
          )}

          {step.command && (
            <div className="flex items-center gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 font-mono text-[12px] text-ink">
              <span style={{ color: 'var(--accent)' }}>$</span>
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{step.command}</span>
              <button onClick={copyCmd} title="copy" className="flex-shrink-0 text-muted hover:text-ink">
                <Copy size={14} />
              </button>
            </div>
          )}

          {step.subtasks.length > 0 && (
            <>
              <div className="mb-2 mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                {t('subTasks', lang)}
              </div>
              <div className="flex flex-col gap-1.5">
                {step.subtasks.map((label, i) => {
                  const checked = done.has(i)
                  return (
                    <button
                      key={i}
                      onClick={() => start(() => toggleSubtask(runId, step.id, i))}
                      className="flex items-center gap-2.5 text-left"
                    >
                      <span
                        className="grid h-4 w-4 flex-shrink-0 place-items-center rounded-[5px] text-[9px]"
                        style={
                          checked
                            ? { background: 'var(--cur)', color: 'var(--primary-fg)' }
                            : { border: '1.5px solid var(--muted)' }
                        }
                      >
                        {checked && <Check size={10} />}
                      </span>
                      <span className={`text-[12.5px] ${checked ? 'text-muted line-through' : 'text-ink-2'}`}>
                        {label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {step.refs.length > 0 && (
            <>
              <div className="mb-2 mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                {t('references', lang)}
              </div>
              <div className="flex flex-wrap gap-2">
                {step.refs.map((r, i) => {
                  const cls =
                    'inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[11.5px] text-accent'
                  return r.url ? (
                    <a key={i} href={r.url} target="_blank" rel="noreferrer" className={cls}>
                      <ExternalLink size={11} /> {r.label}
                    </a>
                  ) : (
                    <span key={i} className={cls}>
                      <ExternalLink size={11} /> {r.label}
                    </span>
                  )
                })}
              </div>
            </>
          )}

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if (note !== step.note) start(() => saveNote(runId, step.id, note))
            }}
            placeholder={t('notePh', lang)}
            className="mt-3.5 w-full rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[12.5px] text-ink outline-none"
          />

          {!isDone && (
            <div className="mt-3 flex gap-2.5">
              <button
                disabled={pending}
                onClick={() => start(() => markStepDone(runId, step.id))}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2.5 text-[13px] font-semibold text-primary-fg disabled:opacity-60"
              >
                <Check size={14} /> {t('markDone', lang)}
              </button>
              <button
                onClick={onToggle}
                className="rounded-md border border-border px-4 py-2.5 text-[13px] font-semibold text-ink-2"
              >
                {t('collapse', lang)}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
