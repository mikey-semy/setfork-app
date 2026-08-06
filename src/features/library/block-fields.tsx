'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { BubbleTextEditor } from '@/shared/ui/BubbleTextEditor'
import { Checkbox } from '@/shared/ui/checkbox'

/**
 * Детали строк редактора: варианты опроса, принимаемые ответы, пары, элементы порядка,
 * подпункты и ссылки — это одна и та же «строка + убрать» плюс «+ добавить». До этого
 * файла каждая стояла своей копией разметки, и правка отступа означала правку в шести
 * местах. Что за поле и когда его нельзя убрать — задают пропы.
 */

/** Однострочное поле. Подпись служит и placeholder'ом, если он не задан. */
export function LineField({ value, onChange, label, placeholder, ru, className = 'flex-1' }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; ru: boolean; className?: string }) {
  return <BubbleTextEditor value={value} onChange={onChange} singleLine className={className} lang={ru ? 'ru' : 'en'} ariaLabel={label} placeholder={placeholder ?? label} />
}

/** Кнопка «убрать строку»; неактивна, когда меньше строк уже нельзя. */
export function RemoveBtn({ onClick, disabled = false, label }: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="text-muted hover:text-danger disabled:opacity-30" aria-label={label}>
      <X size={14} />
    </button>
  )
}

/** Ссылка-действие «+ вариант» под списком строк. */
export function AddLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-accent hover:underline">
      + {children}
    </button>
  )
}

/** Галочка с подписью: мультивыбор, «учитывать регистр» и прочие тумблеры строки. */
export function CheckLabel({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-ink-2">
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

/** Серое пояснение под блоком. */
export const Hint = ({ children }: { children: ReactNode }) => <span className="text-[0.6875rem] text-muted">{children}</span>

/** Ряд действий под списком строк: «+ добавить» и тумблеры. */
export const FieldRow = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-0.5 text-[0.78125rem]">{children}</div>
