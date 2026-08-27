'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PANEL_PAD } from './control'
import { PanelFoot, PanelHead } from './panel-parts'

// Единая модальная панель-оверлей для всех центр-портальных пикеров
// (эмодзи, папки, пины, фильтр, assignee/label/milestone, мобильный поиск).
// Портал в body, затемнённый фон, клик-мимо и Esc закрывают, опциональный
// заголовок с крестиком. Заменяет ~10 копий одинакового скелета.
//
// Шапку и футер рисует не сама панель, а общие PanelHead/PanelFoot — те же, что
// у выбиралок и дока чата: окно ссылки и «Выбрать папку» обязаны выглядеть
// одинаково (требование владельца 09.08.2026).
//
// Якорные дропдауны «под кнопкой» (BranchPicker) — это ДРУГОЙ паттерн
// (absolute к триггеру), их сюда не сводим.
//
// ── Что панель делает для человека без зрения (26.08.2026) ──────────────────
// Модальное окно — это не «прямоугольник поверх». Для диктора это переключение
// контекста, и по WAI-ARIA APG у него ЧЕТЫРЕ обязанности, из которых панель раньше
// выполняла одну (Esc):
//   1. объявить себя окном — role="dialog" + aria-modal, с именем из заголовка;
//   2. увести фокус ВНУТРЬ при открытии — иначе диктор продолжает читать страницу
//      под окном, а Tab уходит в неё же;
//   3. держать фокус внутри, пока окно открыто;
//   4. вернуть фокус на кнопку, которая окно открыла, — чтобы человек не оказался
//      в начале страницы.
// Всё это здесь и живёт: десять окон получают поведение даром, а не каждое своё.

export function OverlayPanel({
  open,
  onClose,
  children,
  title,
  width = 340,
  align = 'center',
  className = '',
  bare = false,
  footer,
  closeLabel,
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  title?: React.ReactNode
  /** Фикс-ширина панели; 0/undefined — по содержимому (эмодзи-пикер и т.п.). */
  width?: number
  /** center — по центру экрана; top — вверху (для поиска/списков, как GitHub). */
  align?: 'center' | 'top'
  className?: string
  /** Содержимое само отвечает за поля (эмодзи-пикер, галерея): панель их не ставит. */
  bare?: boolean
  /** Ряд действий внизу («Отмена» / «Добавить»): панель сама даёт линию и поля. */
  footer?: React.ReactNode
  closeLabel?: string
}) {
  const [mounted, setMounted] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null

    const focusable = () =>
      [...(panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )

    // Фокус внутрь: первый контрол окна, а если контролов нет — само окно.
    const first = focusable()[0]
    ;(first ?? panelRef.current)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) {
        e.preventDefault()
        panelRef.current?.focus()
        return
      }
      const edge = e.shiftKey ? items[0] : items[items.length - 1]
      if (document.activeElement === edge || !panelRef.current?.contains(document.activeElement)) {
        e.preventDefault()
        ;(e.shiftKey ? items[items.length - 1] : items[0]).focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // Возврат фокуса туда, откуда окно открыли: без этого человек оказывается
      // в начале страницы и ищет своё место заново.
      opener?.focus?.()
    }
  }, [open, onClose])

  if (!open || !mounted) return null

  return createPortal(
    <div className={`fixed inset-0 z-50 flex justify-center p-4 ${align === 'center' ? 'items-center' : 'items-start pt-20'}`}>
      {/* Подложка — ОТДЕЛЬНЫЙ элемент, а не родитель окна: так её можно спрятать от
          диктора целиком (aria-hidden), не пряча вместе с ней и само окно. Клик мимо —
          удобство мыши; у клавиатуры для этого есть Esc, он обрабатывается выше.
          Отключать линт не пришлось: правила jsx-a11y пропускают aria-hidden сами —
          скрытый от диктора элемент не обязан быть достижим с клавиатуры. */}
      <div className="animate-sf-fade absolute inset-0 bg-black/30" aria-hidden onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title !== undefined ? titleId : undefined}
        aria-label={title === undefined ? closeLabel : undefined}
        tabIndex={-1}
        style={width ? { width } : undefined}
        // Окно никогда не вырастает выше экрана: высоту ограничивает подложка
        // (max-h-full — это её content-box, уже без полей и верхнего отступа),
        // длинное содержимое прокручивается в теле, а шапка и футер стоят на месте.
        className={`animate-sf-pop relative flex max-h-full max-w-full flex-col rounded-lg border border-border bg-surface shadow-card outline-hidden ${className}`}
      >
        {title !== undefined && <PanelHead titleId={titleId} title={title} onClose={onClose} closeLabel={closeLabel} />}
        {/* Тело всегда с полями панели: раньше отступ задавал КАЖДЫЙ вызывающий,
            и одни окна имели поля, другие упирались в края. */}
        <div className={`min-h-0 flex-1 overflow-y-auto ${bare ? '' : PANEL_PAD}`}>{children}</div>
        {/* Футер действий: линия во всю ширину панели, как и у шапки, а кнопки —
            с теми же полями, что тело. Раньше каждое окно рисовало ряд кнопок
            по-своему: где-то без линии, где-то с другими отступами. */}
        {footer && <PanelFoot>{footer}</PanelFoot>}
      </div>
    </div>,
    document.body,
  )
}
