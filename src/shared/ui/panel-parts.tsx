'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './IconButton'
import { PANEL_HEAD, TEXT } from './control'

/**
 * Шапка и футер всплывающего окна — ОДНИ на все окна приложения.
 *
 * Требование владельца (09.08.2026): все выпадающие окна выглядят как окно
 * ссылки, а линии шапки и футера идут ОТ КРАЯ ДО КРАЯ панели. До этого шапку
 * рисовал каждый вид окна сам: модалка — `px-4 py-3` и кегль 13px, выбиралка —
 * `px-3 py-2` и 12.5px со своим крестиком `size-6`, чат — `px-2.5 py-2` и
 * третий вариант крестика. Разница читается сразу, когда окна открываешь подряд.
 *
 * Полосы дают отступ СЕБЕ, а не панели: поэтому разделитель всегда во всю
 * ширину, чем бы окно ни было — модалкой, выбиралкой или доком чата.
 */
export function PanelHead({
  title,
  titleId,
  onClose,
  closeLabel = 'Close',
  icon,
  actions,
}: {
  title: ReactNode
  /** id заголовка: по нему модальное окно объявляет диктору своё ИМЯ (aria-labelledby). */
  titleId?: string
  /** Без обработчика крестика нет (окно закрывают иначе — кликом мимо). */
  onClose?: () => void
  closeLabel?: string
  /** Значок слева от заголовка (чат кирки). */
  icon?: ReactNode
  /** Свои кнопки перед крестиком (свернуть, обновить). */
  actions?: ReactNode
}) {
  return (
    <div className={`flex shrink-0 items-center gap-2 border-b border-border ${PANEL_HEAD}`}>
      {icon && <span className="shrink-0 text-accent">{icon}</span>}
      <div id={titleId} className={`min-w-0 flex-1 truncate font-semibold text-ink ${TEXT.body}`}>
        {title}
      </div>
      {actions}
      {onClose && (
        // touch="hit": зона нажатия дорастает до 44px, а САМ крестик остаётся 28px.
        // С обычным `box` он раздувал полосу шапки до 60px на телефоне — полосу,
        // высоту которой должен задавать заголовок, а не кнопка закрытия.
        <IconButton variant="ghost" size="sm" touch="hit" label={closeLabel} onClick={onClose}>
          <X size={14} />
        </IconButton>
      )}
    </div>
  )
}

/**
 * Нижняя полоса окна: действия («Отмена» / «Добавить») или своя секция
 * (создание папки, поле чата). Выравнивание задаёт вызывающий через `align`.
 */
export function PanelFoot({ children, align = 'end' }: { children: ReactNode; align?: 'end' | 'stretch' }) {
  return (
    <div className={`shrink-0 border-t border-border ${PANEL_HEAD} ${align === 'end' ? 'flex items-center justify-end gap-2' : ''}`}>
      {children}
    </div>
  )
}
