'use client'

import { Check } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { useSelection } from './selection'

/**
 * Карточка списка в режиме выбора.
 *
 * Обёртка, а не переделка карточки: карточка приезжает готовой с сервера (звёзды, бейджи,
 * состояние модерации — всё её), а здесь добавляется только отметка. Пока режим выключен,
 * обёртки нет вовсе — ни лишнего узла, ни лишней ширины.
 *
 * Карточка на время режима становится `inert`, а не просто «не нажимается»: погасить одни
 * указатели мало — по Tab фокус всё равно уходил бы в ссылки внутри, и клавиатурой человек
 * покидал бы страницу вместо отметки. Поэтому же отметке нужно СВОЁ имя: inert убирает
 * содержимое и из дерева доступности, и без `aria-label` флажок остался бы безымянным.
 */
export function SelectableCard({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  const sel = useSelection()
  if (!sel?.active) return children

  const on = sel.has(id)
  return (
    <div
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      tabIndex={0}
      onClick={() => sel.toggle(id)}
      onKeyDown={(e) => {
        if (e.key !== ' ' && e.key !== 'Enter') return
        e.preventDefault()
        sel.toggle(id)
      }}
      className="flex cursor-pointer select-none items-start gap-2 rounded-lg outline-hidden focus-visible:ring-1 focus-visible:ring-accent"
    >
      <span
        aria-hidden
        className={cn(
          'mt-4 grid size-5 shrink-0 place-items-center rounded border transition-colors',
          on ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface',
        )}
      >
        {on && <Check size={13} strokeWidth={3} />}
      </span>
      <div inert className={cn('min-w-0 flex-1 rounded-lg transition-shadow', on && 'ring-1 ring-accent')}>
        {children}
      </div>
    </div>
  )
}
