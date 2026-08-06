'use client'

import { useLayoutEffect, useRef } from 'react'

/** Длительность и кривая доводки — одни на все карточки. */
const SLIDE_MS = 220
const SLIDE_EASING = 'cubic-bezier(0.2, 0, 0, 1)'

/**
 * Перестановка карточек «доездом», а не прыжком (приём FLIP): меряем положение до
 * и после перерисовки и анимируем разницу средствами браузера (WAAPI). Ключ — не
 * индекс, а стабильный uid: только он говорит, что это та же карточка на новом месте.
 *
 * Возвращает ref на контейнер списка; карточки помечаются `data-uid`.
 * `prefers-reduced-motion` уважается: там движение не нужно, а не «ускорено».
 */
export function useFlipReorder(uids: string[]) {
  const listRef = useRef<HTMLDivElement>(null)
  const previousTops = useRef<Map<string, number>>(new Map())

  useLayoutEffect(() => {
    const nodes = listRef.current?.querySelectorAll<HTMLElement>('[data-uid]')
    if (!nodes) return
    const tops = new Map<string, number>()
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    nodes.forEach((node) => {
      const uid = node.dataset.uid!
      const top = node.getBoundingClientRect().top
      tops.set(uid, top)
      const was = previousTops.current.get(uid)
      if (was != null && was !== top && !reduceMotion) {
        node.animate([{ transform: `translateY(${was - top}px)` }, { transform: 'translateY(0)' }], { duration: SLIDE_MS, easing: SLIDE_EASING })
      }
    })
    previousTops.current = tops
  }, [uids])

  return listRef
}
