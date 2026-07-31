'use client'

import { Check, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { SearchField } from './SearchField'

/**
 * Единая оболочка выпадающих «выбиралок» — список, ветка, папка (как Switch
 * repository / Switch branches у GitHub: одна шапка, одно поле поиска, один вид
 * строки). Раньше каждая панель рисовалась по-своему: разные заголовки, где-то
 * поиск, где-то нет, где-то счётчик в шапке — правило владельца: подобное
 * оформляем одинаково и правим из ОДНОГО места.
 *
 * Сама панель не позиционируется: её кладут в Popover/абсолютный блок вызывающего.
 */
export function PickerPanel({
  title,
  onClose,
  search,
  children,
  footer,
  closeLabel,
}: {
  /** Обычно строка; ReactNode — когда в шапке нужен счётчик выбранного (пины: «3/6»). */
  title: ReactNode
  /** Крестик в шапке; без обработчика крестика нет. */
  onClose?: () => void
  /** Поле поиска в шапке. Не передан — поиска нет (например, когда выбирать не из чего).
   *  autoFocus — для панелей, открывающихся ради поиска (люди по handle). */
  search?: { value: string; onChange: (v: string) => void; placeholder: string; clearLabel: string; autoFocus?: boolean }
  children: ReactNode
  /** Нижняя секция за разделителем — создание новой ветки/папки. */
  footer?: ReactNode
  closeLabel?: string
}) {
  return (
    <div className="flex max-h-[min(420px,70vh)] flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 truncate text-[0.78125rem] font-semibold text-ink">{title}</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {search && (
        <div className="border-b border-border p-2">
          <SearchField
            value={search.value}
            onValueChange={search.onChange}
            placeholder={search.placeholder}
            clearLabel={search.clearLabel}
            autoFocus={search.autoFocus}
            size="sm"
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-1">{children}</div>
      {footer && <div className="border-t border-border p-2">{footer}</div>}
    </div>
  )
}

/**
 * Строка выбора: слева отметка (галка/чекбокс), затем значок и подпись, справа —
 * произвольный слот (бейдж «по умолчанию», счётчик, замок). Один вид на все панели.
 */
export function PickerRow({
  selected = false,
  mark = 'check',
  icon,
  label,
  right,
  onClick,
  disabled,
  actions,
}: {
  selected?: boolean
  /** 'check' — выбор одного (список/ветка); 'box' — множественный (папки). */
  mark?: 'check' | 'box'
  icon?: ReactNode
  label: ReactNode
  right?: ReactNode
  onClick?: () => void
  disabled?: boolean
  /** Действия строки, видимые при наведении (удаление ветки). */
  actions?: ReactNode
}) {
  const body = (
    <>
      {mark === 'box' ? (
        <span
          className={`grid size-4 shrink-0 place-items-center rounded-md border ${
            selected ? 'border-accent bg-accent text-primary-fg' : 'border-border'
          }`}
        >
          {selected && <Check size={12} />}
        </span>
      ) : (
        <span className="grid w-4 shrink-0 place-items-center">
          {selected && <Check size={13} className="text-accent" />}
        </span>
      )}
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {right}
    </>
  )
  // pointer-coarse:min-h-11 — на таче строка добирает тач-цель 44px, на десктопе список остаётся плотным.
  const cls = `flex w-full items-center gap-2 rounded-md px-2 py-1.5 pointer-coarse:min-h-11 text-[0.8125rem] text-ink hover:bg-surface-2 disabled:opacity-60 ${
    selected ? 'bg-surface-2' : ''
  }`

  if (!actions) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={cls}>
        {body}
      </button>
    )
  }
  // Со строчными действиями кнопка внутри кнопки недопустима — раскладываем в ряд.
  return (
    <div className="group flex items-center gap-1">
      <button type="button" onClick={onClick} disabled={disabled} className={cls}>
        {body}
      </button>
      <span className="hidden shrink-0 group-hover:inline-flex">{actions}</span>
    </div>
  )
}
