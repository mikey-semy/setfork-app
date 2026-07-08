'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Award, Ban, Check, CircleAlert, CircleCheckBig, Flag, GraduationCap, Info, RotateCcw, Square, SquareCheckBig, Trash2 } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { t } from '@/shared/i18n'
import type { StepLevel } from '@/shared/db'
import { CopyButton } from '@/shared/ui/CopyButton'
import { Markdown } from '@/shared/ui/Markdown'
import { StepLevelBadge } from '@/shared/ui/StepLevelBadge'
import { safeHref } from '@/shared/lib/safe-url'
import { blockStep, deleteRun, failRun, finishRun, reopenRun, reportBlockedStep, toggleStep, toggleSubtask, unblockStep } from './actions'

export interface RunStepVM {
  id: string
  n: number
  type: string // 'step' (чекается) | 'text' | 'image' (контекст)
  text: string // markdown text-блока
  caption: string // подпись image-блока
  title: string
  desc: string
  command: string
  level: StepLevel
  why: string
  subtasks: string[]
  // href — трекинговый /api/go/<stepId>/<i> (журнал кликов); url — прямая ссылка.
  refs: { label: string; url?: string; href?: string }[]
  done: boolean
  blocked: boolean
  reason: string
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
  certificateHref,
}: {
  runId: string
  status: 'active' | 'done' | 'abandoned' | 'failed'
  ordered: boolean
  title: string
  backHref: string
  steps: RunStepVM[]
  lang: Lang
  certificateHref?: string
}) {
  const ru = lang === 'ru'
  const [steps, setSteps] = useState(initial)
  const [, start] = useTransition()
  const [blockingId, setBlockingId] = useState<string | null>(null)
  const [reasonDraft, setReasonDraft] = useState('')
  // Прогресс — только по шаг-блокам (text/image — контекст, не чекаются).
  const isStep = (s: RunStepVM) => !s.type || s.type === 'step'
  const total = steps.filter(isStep).length
  const done = steps.filter((s) => isStep(s) && s.done).length
  const blockedCount = steps.filter((s) => isStep(s) && s.blocked).length
  const pct = total ? Math.round((done / total) * 100) : 0
  const closed = status === 'done' || status === 'failed' || status === 'abandoned'

  const patch = (i: number, p: Partial<RunStepVM>) => setSteps((xs) => xs.map((s, idx) => (idx === i ? { ...s, ...p } : s)))

  function toggle(i: number) {
    const s = steps[i]
    patch(i, { done: !s.done, blocked: false })
    start(() => toggleStep(runId, s.id))
  }
  function toggleSub(i: number, idx: number) {
    const s = steps[i]
    const has = s.subtasksDone.includes(idx)
    patch(i, { subtasksDone: has ? s.subtasksDone.filter((x) => x !== idx) : [...s.subtasksDone, idx] })
    start(() => toggleSubtask(runId, s.id, idx))
  }
  function confirmBlock(i: number) {
    const s = steps[i]
    const reason = reasonDraft.trim()
    patch(i, { blocked: true, done: false, reason })
    setBlockingId(null)
    setReasonDraft('')
    start(() => blockStep(runId, s.id, reason))
  }
  function unblock(i: number) {
    const s = steps[i]
    patch(i, { blocked: false, reason: '' })
    start(() => unblockStep(runId, s.id))
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
              {status === 'done' ? (
                t('runDone', lang)
              ) : status === 'failed' ? (
                <span className="text-danger">
                  {t('runFailed', lang)}
                  {blockedCount > 0 && ` · ${blockedCount} ${t('runBlockedLabel', lang)}`}
                </span>
              ) : (
                `${done} / ${total} · ${pct}%${blockedCount > 0 ? ` · ${blockedCount} ${t('runBlockedLabel', lang)}` : ''}`
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {closed ? (
              <button
                type="button"
                onClick={() => start(() => reopenRun(runId))}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-[12.5px] text-ink hover:border-border-strong"
              >
                <RotateCcw size={13} /> {t('runReopen', lang)}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => start(() => finishRun(runId))}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-primary-fg"
                >
                  <CircleCheckBig size={13} /> {t('runFinish', lang)}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(t('runFailConfirm', lang))) start(() => failRun(runId))
                  }}
                  title={t('runFailAction', lang)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 px-3 py-1.5 text-[12.5px] font-medium text-danger hover:bg-danger/10"
                >
                  <CircleAlert size={13} /> {t('runFailAction', lang)}
                </button>
              </>
            )}
            {/* Delete — реально удаляет прогон (в отличие от «завершить/неудача»), уводит на /runs */}
            <button
              type="button"
              onClick={() => {
                if (confirm(t('runDeleteConfirm', lang))) start(() => deleteRun(runId))
              }}
              title={t('runDelete', lang)}
              aria-label={t('runDelete', lang)}
              className="grid h-8 w-8 place-items-center rounded-md text-muted hover:text-danger"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-ok transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Все шаги сделаны → курс пройден: ссылка на сертификат. */}
      {certificateHref && total > 0 && done === total && blockedCount === 0 && (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-ok/40 bg-ok/10 px-4 py-3">
          <GraduationCap size={18} className="shrink-0 text-ok" />
          <span className="min-w-0 flex-1 text-[13px] font-medium text-ink">{ru ? 'Курс пройден — все шаги выполнены' : 'Course complete — all steps done'}</span>
          <Link href={certificateHref} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-ok/40 bg-surface px-2.5 py-1.5 text-[12.5px] font-medium text-ok hover:bg-ok/15">
            <Award size={14} /> {ru ? 'Сертификат' : 'Certificate'}
          </Link>
        </div>
      )}

      {/* Шаги */}
      <div className="flex flex-col gap-3">
        {steps.map((s, i) => {
          // Презентационные блоки — контекст: без чекбокса и контролов.
          if (!isStep(s)) {
            if (s.type === 'text') {
              return s.text ? (
                <div key={s.id} className="px-1">
                  <Markdown className="text-[14px] leading-relaxed text-ink-2">{s.text}</Markdown>
                </div>
              ) : null
            }
            return s.caption ? (
              <div key={s.id} className="px-1 text-[13px] italic text-muted">🖼 {s.caption}</div>
            ) : null
          }
          // Порядковый номер шага (только по шаг-блокам).
          const stepNo = steps.slice(0, i).filter(isStep).length + 1
          return (
          <div
            key={s.id}
            className={`rounded-lg border p-4 transition-colors ${
              s.blocked ? 'border-danger/40 bg-danger/5' : s.done ? 'border-ok/40 bg-ok/5' : 'border-border bg-surface'
            }`}
          >
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => toggle(i)}
                aria-label={s.done ? 'uncheck' : 'check'}
                className={`mt-0.5 shrink-0 ${s.done ? 'text-ok' : 'text-muted hover:text-ink'}`}
              >
                {s.done ? <SquareCheckBig size={20} /> : <Square size={20} />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  {ordered && <span className="font-mono text-[12px] text-muted">{stepNo}</span>}
                  <span className={`text-[14.5px] font-semibold ${s.done ? 'text-ink-2 line-through' : 'text-ink'}`}>{s.title}</span>
                  <StepLevelBadge level={s.level} lang={lang} />
                </div>
                {s.desc && <Markdown className="mt-1">{s.desc}</Markdown>}
                {s.why && (
                  <div className="mt-1.5 flex gap-1.5 text-[12.5px] text-ink-2">
                    <Info size={13} className="mt-0.5 shrink-0 text-muted" />
                    <span>
                      <span className="font-medium">{t('whyLabel', lang)}:</span> {s.why}
                    </span>
                  </div>
                )}

                {s.command && (
                  <div className="mt-3 flex items-center gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 font-mono text-[12px] text-ink">
                    <span className="shrink-0" style={{ color: 'var(--accent)' }}>$</span>
                    {/* Горизонтальный скролл + выделение части строки (см. list detail). */}
                    <span className="no-scrollbar min-w-0 flex-1 select-text overflow-x-auto whitespace-nowrap">{s.command}</span>
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
                            <span className={`mt-0.5 shrink-0 ${checked ? 'text-ok' : 'text-muted'}`}>
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
                          href={safeHref(r.href ?? r.url) || undefined}
                          target="_blank"
                          rel="nofollow noreferrer"
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

                {/* Неудачный путь: «не получилось» → причина → сообщить */}
                {!closed && !s.blocked && !s.done && blockingId !== s.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setBlockingId(s.id)
                      setReasonDraft('')
                    }}
                    className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-danger"
                  >
                    <Ban size={13} /> {t('runCantComplete', lang)}
                  </button>
                )}
                {blockingId === s.id && (
                  <div className="mt-3 rounded-md border border-danger/40 bg-danger/5 p-2.5">
                    <textarea
                      autoFocus
                      value={reasonDraft}
                      onChange={(e) => setReasonDraft(e.target.value)}
                      rows={2}
                      aria-label={t('runReasonPh', lang)}
                      placeholder={t('runReasonPh', lang)}
                      className="w-full resize-none rounded border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-border-strong"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => confirmBlock(i)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-danger px-3 py-1.5 text-[12.5px] font-semibold text-white"
                      >
                        <Ban size={13} /> {t('runBlockAction', lang)}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBlockingId(null)
                          setReasonDraft('')
                        }}
                        className="rounded-md px-2.5 py-1.5 text-[12.5px] text-ink-2 hover:text-ink"
                      >
                        {t('cancel', lang)}
                      </button>
                    </div>
                  </div>
                )}
                {s.blocked && blockingId !== s.id && (
                  <div className="mt-3 rounded-md border border-danger/40 bg-danger/5 p-2.5 text-[12.5px]">
                    <div className="flex items-center gap-1.5 font-semibold text-danger">
                      <Ban size={13} /> {t('runBlockedLabel', lang)}
                      {s.reason ? ':' : ''}
                    </div>
                    {s.reason && <div className="mt-0.5 text-ink-2">{s.reason}</div>}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => start(() => reportBlockedStep(runId, s.id))}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-ink hover:border-border-strong"
                      >
                        <Flag size={12} /> {t('runReport', lang)}
                      </button>
                      {!closed && (
                        <button type="button" onClick={() => unblock(i)} className="rounded-md px-2.5 py-1.5 text-[12px] text-ink-2 hover:text-ink">
                          {t('runUnblock', lang)}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          )
        })}
      </div>
    </div>
  )
}
