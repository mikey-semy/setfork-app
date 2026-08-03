'use client'

import { useEffect, useState } from 'react'

// ПОЧЕМУ ЭТО ЕСТЬ. `position: fixed; bottom: N` считает низ от layout viewport, а
// человек видит visual viewport. На мобиле они расходятся (панели браузера,
// виртуальная клавиатура, зум), и тогда «прижатая к низу» кнопка честно сидит внизу
// СТРАНИЦЫ, а на экране висит посередине — ровно жалоба владельца 03.08.2026: чат
// раскопок и кнопка «наверх» открывались в середине экрана при обычной прокрутке.
//
// Разница между этими вьюпортами и есть поправка: сколько layout-низа скрыто ниже
// того, что видно. Прибавляем её к bottom — и элемент садится к ВИДИМОМУ низу, чем бы
// расхождение ни было вызвано (клавиатура, панель браузера, режим захвата).

export interface ViewportBottom {
  /** Сколько пикселей layout-низа скрыто ниже видимой области (0 — вьюпорты совпадают). */
  gap: number
  /** Высота видимой области; по ней ограничиваем «подъём» плавающих кнопок. */
  visibleHeight: number
}

/** Чистый расчёт поправки — тестируется без браузера. */
export function viewportBottomGap(m: { innerHeight: number; visualHeight: number; visualOffsetTop: number }): number {
  return Math.max(0, Math.round(m.innerHeight - m.visualHeight - m.visualOffsetTop))
}

/**
 * Насколько поднять элемент над нижней панелью так, чтобы он остался НА ЭКРАНЕ.
 * Чат раскопок растёт до 70% высоты, и кнопка «наверх», честно севшая над ним,
 * улетала за верхний край (жалоба владельца: «лишь бы за верхнюю часть экрана не
 * улетала»). Поэтому подъём ограничен: элемент не выше верхней кромки видимой
 * области, с зазором на собственный размер.
 */
export function clampedBottom(m: { desired: number; visibleHeight: number; selfSize: number; margin?: number }): number {
  const margin = m.margin ?? 16
  const ceiling = Math.max(margin, m.visibleHeight - m.selfSize - margin)
  return Math.min(m.desired, ceiling)
}

/** Поправка на расхождение вьюпортов + текущая видимая высота. Пересчёт на resize/scroll. */
export function useViewportBottom(): ViewportBottom {
  // SSR и браузеры без visualViewport: поправка 0, поведение прежнее (bottom из класса).
  const [state, setState] = useState<ViewportBottom>({ gap: 0, visibleHeight: 0 })

  useEffect(() => {
    const vv = window.visualViewport
    const update = () => {
      const visualHeight = vv?.height ?? window.innerHeight
      setState({
        gap: vv ? viewportBottomGap({ innerHeight: window.innerHeight, visualHeight: vv.height, visualOffsetTop: vv.offsetTop }) : 0,
        visibleHeight: Math.round(visualHeight),
      })
    }
    update()
    // Скролл visual viewport — это как раз «панель браузера уехала/приехала».
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return state
}
