'use client'
import { useTransition } from 'react'
import { ChevronDown, Milestone as MilestoneIcon, X } from 'lucide-react'
import { AnchoredMenu } from '@/shared/ui/AnchoredMenu'
import { PickerPanel, PickerRow } from '@/shared/ui/PickerPanel'
import { setIssueMilestone } from '@/features/milestones/actions'

type Opt = { id: string; title: string; closed: boolean }

// Выбор вехи для issue (одна): текущая + дропдаун вех репо (для владельца/коллаборатора).
export function MilestonePicker({
  owner,
  slug,
  number,
  onSet,
  current,
  options,
  canEdit,
  lang = 'en',
}: {
  owner: string
  slug: string
  /** Номер задачи; для правки не нужен — действие приходит пропом. */
  number?: number
  current: { id: string; title: string } | null
  options: Opt[]
  canEdit: boolean
  /** Своё присвоение этапа (правка). Пусто — задачное. */
  onSet?: (milestoneId: string) => Promise<void>
  lang?: string
}) {
  const [pending, start] = useTransition()
  const L = (ru: string, en: string) => (lang === 'ru' ? ru : en)
  // Своё присвоение (правка) или задачное по умолчанию — один пикер на обе сущности.
  const set = (id: string) =>
    start(() => void (onSet ? onSet(id) : number != null ? setIssueMilestone(owner, slug, number, id) : Promise.resolve()))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">{L('Веха', 'Milestone')}</span>
        {canEdit && (
          <AnchoredMenu
            align="right"
            width={240}
            button={(toggle) => (
              <button type="button" onClick={toggle} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-ink">
                <ChevronDown size={14} />
              </button>
            )}
          >
            {(close) => (
              <PickerPanel title={L('Веха', 'Milestone')} onClose={close} closeLabel={L('закрыть', 'close')}>
                <PickerRow
                  disabled={pending}
                  selected={!current}
                  onClick={() => { set(''); close() }}
                  label={<span className="text-muted">{L('без вехи', 'no milestone')}</span>}
                />
                {options.length === 0 && <div className="px-2 py-3 text-[12.5px] text-muted">{L('вех нет', 'no milestones')}</div>}
                {options.map((m) => (
                  <PickerRow
                    key={m.id}
                    disabled={pending}
                    selected={current?.id === m.id}
                    onClick={() => { set(m.id); close() }}
                    label={<span className={m.closed ? 'text-muted line-through' : 'text-ink'}>{m.title}</span>}
                  />
                ))}
              </PickerPanel>
            )}
          </AnchoredMenu>
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
