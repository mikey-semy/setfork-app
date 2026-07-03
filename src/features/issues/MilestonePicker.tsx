'use client'
import { useState, useTransition } from 'react'
import { Check, ChevronDown, Milestone as MilestoneIcon, X } from 'lucide-react'
import { setIssueMilestone } from '@/features/milestones/actions'

type Opt = { id: string; title: string; closed: boolean }

// Выбор вехи для issue (одна): текущая + дропдаун вех репо (для владельца/коллаборатора).
export function MilestonePicker({
  owner,
  slug,
  number,
  current,
  options,
  canEdit,
  lang = 'en',
}: {
  owner: string
  slug: string
  number: number
  current: { id: string; title: string } | null
  options: Opt[]
  canEdit: boolean
  lang?: string
}) {
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const L = (ru: string, en: string) => (lang === 'ru' ? ru : en)
  const set = (id: string) => {
    setOpen(false)
    start(() => void setIssueMilestone(owner, slug, number, id))
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">{L('Веха', 'Milestone')}</span>
        {canEdit && (
          <div className="relative">
            <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-ink">
              <ChevronDown size={14} />
            </button>
            {open && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 max-h-60 w-60 overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
                  <button type="button" disabled={pending} onClick={() => set('')} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] text-ink-2 hover:bg-surface-2">
                    <span className="text-muted">{L('без вехи', 'no milestone')}</span>
                    {!current && <Check size={14} className="text-accent" />}
                  </button>
                  {options.length === 0 && <div className="px-3 py-2 text-[12.5px] text-muted">{L('вех нет', 'no milestones')}</div>}
                  {options.map((m) => (
                    <button key={m.id} type="button" disabled={pending} onClick={() => set(m.id)} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] text-ink-2 hover:bg-surface-2">
                      <span className={`truncate ${m.closed ? 'text-muted line-through' : 'text-ink'}`}>{m.title}</span>
                      {current?.id === m.id && <Check size={14} className="shrink-0 text-accent" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {current ? (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-[12.5px]">
          <MilestoneIcon size={13} className="text-accent" />
          <span className="text-ink">{current.title}</span>
          {canEdit && (
            <button type="button" disabled={pending} onClick={() => set('')} aria-label={L('снять', 'clear')} className="text-muted hover:text-danger">
              <X size={13} />
            </button>
          )}
        </span>
      ) : (
        <span className="text-[13px] text-muted">{L('без вехи', 'no milestone')}</span>
      )}
    </div>
  )
}
