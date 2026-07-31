'use client'

import { useState } from 'react'
import { GitMerge } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import type { Lang } from '@/shared/i18n'
import type { MetaConflict, StepConflict, TwStep, Choice } from './three-way'

// UI разрешения конфликтов branch-PR (A4): по каждому конфликтному шагу и
// meta-полю пользователь выбирает ours (main) или theirs (ветка). Выбор
// уходит формой (hidden JSON) в resolveBranchPr — сервер пересчитывает merge
// детерминированно и собирает финальный list.json.

function StepCard({ s, deleted, ru }: { s: TwStep | null; deleted: string; ru: boolean }) {
  if (!s) return <div className="px-3 py-2 text-[12.5px] italic text-muted">{deleted}</div>
  return (
    <div className="min-w-0 px-3 py-2">
      <div className="truncate text-[13px] font-semibold text-ink">{s.title}</div>
      {s.desc && <div className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[12.5px] text-ink-2">{s.desc}</div>}
      {s.command && (
        <code className="mt-1 block truncate rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-ink-2">{s.command}</code>
      )}
      {s.why && <div className="mt-0.5 truncate text-[12px] text-muted">{ru ? 'зачем: ' : 'why: '}{s.why}</div>}
    </div>
  )
}

function Side({
  label,
  tone,
  selected,
  onSelect,
  children,
}: {
  label: string
  tone: 'ours' | 'theirs'
  selected: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`min-w-0 flex-1 rounded-md border text-left transition-colors ${
        selected ? (tone === 'ours' ? 'border-accent bg-(--accent-soft)' : 'border-ok bg-ok/10') : 'border-border bg-surface hover:border-border-strong'
      }`}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <span className={`h-2 w-2 rounded-full ${selected ? (tone === 'ours' ? 'bg-accent' : 'bg-ok') : 'bg-border'}`} />
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      </div>
      {children}
    </button>
  )
}

export function ConflictResolver({
  conflicts,
  metaConflicts,
  branch,
  lang,
  action,
}: {
  conflicts: StepConflict[]
  metaConflicts: MetaConflict[]
  branch: string
  lang: Lang
  action: (formData: FormData) => Promise<void>
}) {
  const ru = lang === 'ru'
  const [stepChoices, setStepChoices] = useState<Record<string, Choice>>({})
  const [metaChoices, setMetaChoices] = useState<Record<string, Choice>>({})
  const total = conflicts.length + metaConflicts.length
  const chosen = Object.keys(stepChoices).length + Object.keys(metaChoices).length
  const ready = chosen === total

  const oursLabel = ru ? 'main (наша)' : 'main (ours)'
  const theirsLabel = branch

  return (
    <form action={action} className="mt-3 rounded-lg border border-warn/50 bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2.5">
        <GitMerge size={14} className="text-warn" />
        <span className="text-[13.5px] font-semibold text-ink">
          {ru ? 'Конфликты шагов' : 'Step conflicts'}
        </span>
        <Badge variant="soft">{chosen}/{total}</Badge>
        <span className="text-[12px] text-muted">
          {ru ? 'выбери версию каждого конфликтующего элемента' : 'pick a side for each conflicting item'}
        </span>
      </div>

      <div className="flex flex-col gap-3 px-3.5 py-3">
        {metaConflicts.map((m) => (
          <div key={m.field}>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-widest text-muted">
              {ru ? 'поле' : 'field'}: {m.field}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Side label={oursLabel} tone="ours" selected={metaChoices[m.field] === 'ours'} onSelect={() => setMetaChoices((c) => ({ ...c, [m.field]: 'ours' }))}>
                <div className="px-3 py-2 text-[12.5px] text-ink-2">{JSON.stringify(m.ours)}</div>
              </Side>
              <Side label={theirsLabel} tone="theirs" selected={metaChoices[m.field] === 'theirs'} onSelect={() => setMetaChoices((c) => ({ ...c, [m.field]: 'theirs' }))}>
                <div className="px-3 py-2 text-[12.5px] text-ink-2">{JSON.stringify(m.theirs)}</div>
              </Side>
            </div>
          </div>
        ))}

        {conflicts.map((c) => (
          <div key={c.key}>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-widest text-muted">
              {c.kind === 'modified'
                ? ru ? 'изменён в обеих' : 'modified in both'
                : c.kind === 'delete-ours'
                  ? ru ? 'удалён в main · изменён в ветке' : 'deleted in main · modified in branch'
                  : ru ? 'изменён в main · удалён в ветке' : 'modified in main · deleted in branch'}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Side label={oursLabel} tone="ours" selected={stepChoices[c.key] === 'ours'} onSelect={() => setStepChoices((ch) => ({ ...ch, [c.key]: 'ours' }))}>
                <StepCard s={c.ours} deleted={ru ? '(шаг удалён)' : '(step deleted)'} ru={ru} />
              </Side>
              <Side label={theirsLabel} tone="theirs" selected={stepChoices[c.key] === 'theirs'} onSelect={() => setStepChoices((ch) => ({ ...ch, [c.key]: 'theirs' }))}>
                <StepCard s={c.theirs} deleted={ru ? '(шаг удалён)' : '(step deleted)'} ru={ru} />
              </Side>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-border px-3.5 py-2.5">
        <span className="text-[12px] text-muted">
          {ru
            ? 'Результат — merge-commit в main; md-оверрайды шагов сбрасываются.'
            : 'Result is a merge commit on main; per-step md overrides are reset.'}
        </span>
        <input type="hidden" name="stepChoices" value={JSON.stringify(stepChoices)} />
        <input type="hidden" name="metaChoices" value={JSON.stringify(metaChoices)} />
        <SubmitButton className={ready ? undefined : 'pointer-events-none bg-surface-2 text-muted'}>
          <GitMerge size={14} /> {ru ? 'Разрешить и влить' : 'Resolve and merge'}
        </SubmitButton>
      </div>
    </form>
  )
}
