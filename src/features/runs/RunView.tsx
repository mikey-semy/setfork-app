'use client'

import { useState } from 'react'
import { t, type Lang } from '@/shared/i18n'
import { RunStep, type RunStepData } from './RunStep'

export function RunView({
  runId,
  steps,
  lang,
}: {
  runId: string
  steps: RunStepData[]
  lang: Lang
}) {
  const [compact, setCompact] = useState(false)
  // По умолчанию раскрыт текущий шаг (do-confirm фокус из дизайна).
  const curId = steps.find((s) => s.status === 'cur')?.id
  const [open, setOpen] = useState<Record<string, boolean>>(curId ? { [curId]: true } : {})

  return (
    <>
      <div className="mb-2 flex justify-end px-1">
        <span className="inline-flex gap-0.5 rounded-full border border-border bg-surface-2 p-0.5">
          {(
            [
              ['detailed', !compact, () => setCompact(false)],
              ['compact', compact, () => setCompact(true)],
            ] as const
          ).map(([key, active, on]) => (
            <button
              key={key}
              onClick={on}
              className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${
                active ? 'bg-[var(--accent-soft)] text-ink' : 'text-ink-2'
              }`}
            >
              {t(key, lang)}
            </button>
          ))}
        </span>
      </div>
      <div className="flex flex-col">
        {steps.map((step) => (
          <RunStep
            key={step.id}
            runId={runId}
            step={step}
            lang={lang}
            compact={compact}
            open={!!open[step.id]}
            onToggle={() => setOpen((o) => ({ ...o, [step.id]: !o[step.id] }))}
          />
        ))}
      </div>
    </>
  )
}
