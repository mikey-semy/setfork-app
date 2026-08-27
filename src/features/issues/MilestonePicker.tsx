'use client'
import { useTransition } from 'react'
import { ChevronDown, Milestone as MilestoneIcon, X } from 'lucide-react'
import { AnchoredMenu } from '@/shared/ui/AnchoredMenu'
import { PickerPanel, PickerRow } from '@/shared/ui/PickerPanel'
import { setIssueMilestone } from '@/features/milestones/actions'
import { buttonClass } from '@/shared/ui/button-style'
import { Badge } from '@/shared/ui/badge'
import { IconButton } from '@/shared/ui/IconButton'

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
        <span className="text-body-sm font-semibold uppercase tracking-[0.04em] text-muted">{L('Веха', 'Milestone')}</span>
        {canEdit && (
          <AnchoredMenu
            align="right"
            width={240}
            button={(toggle) => (
              <IconButton variant="ghost" onClick={toggle} label={L('Выбрать веху', 'Pick milestone')} className="hover:bg-surface-2">
                <ChevronDown size={14} />
              </IconButton>
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
                {options.length === 0 && <div className="px-2 py-3 text-body-sm text-muted">{L('вех нет', 'no milestones')}</div>}
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
        <Badge variant="chip" size="md" className="w-fit min-w-0 max-w-full gap-1.5">
          <MilestoneIcon size={13} className="shrink-0 text-accent" />
          {/* Название вехи — до 120 символов от человека: без переноса чип уносил
              сайдбар задачи за край (замер: 906px при экране 390). */}
          <span className="min-w-0 text-ink [overflow-wrap:anywhere]">{current.title}</span>
          {canEdit && (
            <IconButton size="xs" variant="ghost" disabled={pending} onClick={() => set('')} label={L('снять', 'clear')} className="text-muted hover:text-danger">
              <X size={13} />
            </IconButton>
          )}
        </Badge>
      ) : (
        <span className="text-body text-muted">{L('без вехи', 'no milestone')}</span>
      )}
    </div>
  )
}
