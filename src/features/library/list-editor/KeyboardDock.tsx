'use client'

import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import { LAYER } from '@/shared/ui/control'
import { useViewportBottom } from '@/shared/ui/use-viewport-bottom'

/** Поле ввода — то, ради чего открывается клавиатура. */
const isField = (el: Element | null): boolean =>
  el instanceof HTMLElement && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)

/**
 * Панель прилипает к верхней кромке виртуальной клавиатуры, пока правят текст.
 *
 * На телефоне отмена и повтор стояли в самом верху формы — на длинном списке до них
 * не дотянуться, а место под большой палец как раз над клавиатурой (thumb zone).
 * Насколько поднять, знает use-viewport-bottom: `position: fixed; bottom: 0` считает
 * низ СТРАНИЦЫ, а клавиатура закрывает низ ЭКРАНА, и без поправки панель уезжает под
 * неё. Своего расчёта здесь нет намеренно — он уже написан и проверен тестами.
 *
 * На широком экране панель остаётся в потоке: клавиатура там железная и ничего не
 * закрывает.
 */
export function KeyboardDock({ scopeRef, children }: { scopeRef: RefObject<HTMLElement | null>; children: ReactNode }) {
  const { gap } = useViewportBottom()
  const [docked, setDocked] = useState(false)

  useEffect(() => {
    const sync = () => {
      const narrow = window.matchMedia('(max-width: 639px)').matches
      const el = document.activeElement
      setDocked(narrow && isField(el) && !!scopeRef.current?.contains(el))
    }
    // focusout приходит ДО того, как активным станет новый элемент, — иначе панель
    // мигала бы при переходе между соседними полями.
    const later = () => requestAnimationFrame(sync)
    document.addEventListener('focusin', later)
    document.addEventListener('focusout', later)
    return () => {
      document.removeEventListener('focusin', later)
      document.removeEventListener('focusout', later)
    }
  }, [scopeRef])

  if (!docked) return children
  return (
    <div className={`fixed inset-x-0 border-t border-border bg-surface px-3 py-2 ${LAYER.sticky}`} style={{ bottom: gap }}>
      {children}
    </div>
  )
}
