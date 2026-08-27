'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { BubbleTextEditor } from '@/shared/ui/BubbleTextEditor'
import { Checkbox } from '@/shared/ui/checkbox'
import { iconSizeFor, TEXT, TOUCH_MIN_H } from '@/shared/ui/control'
import { IconButton } from '@/shared/ui/IconButton'
import { TextButton } from '@/shared/ui/TextButton'

/**
 * Детали строк редактора: варианты опроса, принимаемые ответы, пары, элементы порядка,
 * подпункты и ссылки — это одна и та же «строка + убрать» плюс «+ добавить». До этого
 * файла каждая стояла своей копией разметки, и правка отступа означала правку в шести
 * местах. Что за поле и когда его нельзя убрать — задают пропы.
 */

/** Однострочное поле. Подпись служит и placeholder'ом, если он не задан. */
export function LineField({ value, onChange, label, placeholder, lang, className = 'flex-1' }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; lang: Lang; className?: string }) {
  return <BubbleTextEditor value={value} onChange={onChange} singleLine className={className} lang={lang} ariaLabel={label} placeholder={placeholder ?? label} />
}

/** Кнопка «убрать строку»; неактивна, когда меньше строк уже нельзя. */
export function RemoveBtn({ onClick, disabled = false, label }: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <IconButton size="sm" variant="danger" onClick={onClick} disabled={disabled} label={label}>
      <X size={iconSizeFor('sm')} />
    </IconButton>
  )
}

/**
 * Ряд настройки шага: подпись слева, контрол справа.
 *
 * Уровень, «нужен человек» и «разрушительный пункт» рисовались тремя разными
 * способами — разные кегли подписи, разные отступы, разное выравнивание, и
 * карточка выглядела набором случайных строк (замечание владельца 09.08.2026).
 * Теперь у всех трёх одна форма, и новая настройка получает её даром.
 */
export function SettingRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <span className={`min-w-0 truncate ${TEXT.bodySm} text-muted`}>{label}</span>
      {children}
    </div>
  )
}

/** Ссылка-действие «+ вариант» под списком строк. */
export function AddLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    // Вид ссылки, цель — кнопки: пальцем в 19px строки текста не попадают.
    <TextButton tone="accent" onClick={onClick}>
      + {children}
    </TextButton>
  )
}

/** Галочка с подписью: мультивыбор, «учитывать регистр» и прочие тумблеры строки. */
export function CheckLabel({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <label className={`inline-flex cursor-pointer items-center gap-1.5 text-ink-2 ${TOUCH_MIN_H}`}>
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

/** Серое пояснение под блоком. */
export const Hint = ({ children }: { children: ReactNode }) => <span className={`${TEXT.caption} text-muted`}>{children}</span>

/** Ряд действий под списком строк: «+ добавить» и тумблеры. */
export const FieldRow = ({ children }: { children: ReactNode }) => <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 pt-0.5 ${TEXT.bodySm}`}>{children}</div>
