'use client'
import { useState, useTransition } from 'react'
import { UserPlus, X } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { AnchoredMenu } from '@/shared/ui/AnchoredMenu'
import { PickerPanel, PickerRow } from '@/shared/ui/PickerPanel'
import { toggleIssueAssignee } from './actions'


type Person = { handle: string; avatarUrl: string | null }

// Люди при сущности: текущий список + поповер-поиск (для владельца/коллаборатора).
// Один пикер на исполнителей задачи, исполнителей правки и ЗАПРОШЕННЫХ рецензентов —
// форма одинаковая (набор людей + поиск по handle), различаются только подписи и
// действие. Копировать его третий раз было бы ровно то, чего просили не делать.
export function AssigneePicker({
  owner,
  slug,
  number,
  assignees,
  canEdit,
  onToggle,
  labels,
  lang = 'en',
}: {
  owner: string
  slug: string
  /** Номер задачи; для правки не нужен — там переключение идёт через onToggle. */
  number?: number
  assignees: Person[]
  canEdit: boolean
  /** Своё переключение исполнителя. Пусто — задачное (toggleIssueAssignee).
   *  Так один пикер обслуживает и задачи, и правки, вместо двух копий. */
  onToggle?: (handle: string) => Promise<void>
  /** Свои подписи (напр. «Рецензенты» / «никого не просили»); пусто — исполнительские. */
  labels?: { title: string; add: string; empty: string; remove: string }
  lang?: string
}) {
  const [pending, start] = useTransition()
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Person[]>([])
  const L = (ru: string, en: string) => (lang === 'ru' ? ru : en)
  const has = new Set(assignees.map((a) => a.handle))
  // Переключение: своё (правка) или задачное по умолчанию — один пикер на обе сущности.
  const toggle = (handle: string) =>
    start(() => void (onToggle ? onToggle(handle) : number != null ? toggleIssueAssignee(owner, slug, number, handle) : Promise.resolve()))

  async function search(v: string) {
    if (!v.trim()) return setFound([])
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(v.trim())}`)
      setFound((await res.json()) as Person[])
    } catch {
      setFound([])
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">{labels?.title ?? L('Исполнители', 'Assignees')}</span>
        {canEdit && (
          <AnchoredMenu
            align="right"
            width={240}
            button={(toggleMenu) => (
              <button
                type="button"
                onClick={toggleMenu}
                aria-label={labels?.add ?? L('назначить', 'assign')}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-ink"
              >
                <UserPlus size={14} />
              </button>
            )}
          >
            {(close) => (
              <PickerPanel
                title={labels?.title ?? L('Исполнители', 'Assignees')}
                onClose={close}
                closeLabel={L('закрыть', 'close')}
                search={{
                  value: query,
                  onChange: (v) => {
                    // Пустой ввод (в т.ч. крестик ×) сразу чистит результаты — как раньше onClear.
                    setQuery(v)
                    void search(v)
                  },
                  placeholder: L('поиск по handle…', 'search by handle…'),
                  clearLabel: L('очистить', 'clear'),
                  autoFocus: true,
                }}
              >
                {found.length === 0 ? (
                  <div className="px-2 py-3 text-[12.5px] text-muted">{L('начните вводить handle', 'start typing a handle')}</div>
                ) : (
                  found.map((u) => (
                    <PickerRow
                      key={u.handle}
                      disabled={pending}
                      selected={has.has(u.handle)}
                      onClick={() => toggle(u.handle)}
                      icon={<Avatar handle={u.handle} avatarUrl={u.avatarUrl} size={20} />}
                      label={u.handle}
                    />
                  ))
                )}
              </PickerPanel>
            )}
          </AnchoredMenu>
        )}
      </div>

      {assignees.length === 0 ? (
        <span className="text-[13px] text-muted">{labels?.empty ?? L('никого', 'no one')}</span>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {assignees.map((a) => (
            <span key={a.handle} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 py-0.5 pl-0.5 pr-2 text-[12.5px]">
              <Avatar handle={a.handle} avatarUrl={a.avatarUrl} size={20} />
              <span className="text-ink">{a.handle}</span>
              {canEdit && (
                <button type="button" disabled={pending} onClick={() => toggle(a.handle)} aria-label={labels?.remove ?? L('снять', 'unassign')} className="text-muted hover:text-danger">
                  <X size={13} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
