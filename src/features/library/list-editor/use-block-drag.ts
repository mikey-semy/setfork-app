'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { dropTargetIndex } from './block-ops'
import { edgeScrollStep, movedEnough, targetAt, type Band } from './drag-geometry'

/** Что тащат и куда целятся — ОДНО значение, а не три переменные: сочетания вроде
 *  «цель есть, а тащить нечего» становятся невыразимыми. */
type Dragging = { from: number; over: number; side: 'before' | 'after' } | null

/** Полосы карточек в координатах документа — снимок на момент начала переноса. */
function measureBands(list: HTMLElement | null): Band[] {
  if (!list) return []
  const pageY = window.scrollY
  return [...list.querySelectorAll<HTMLElement>('[data-i]')].map((card) => {
    const box = card.getBoundingClientRect()
    return { top: box.top + pageY, bottom: box.bottom + pageY }
  })
}

/**
 * Перенос карточек указателем — одинаково мышью и пальцем.
 *
 * Pointer Events вместо HTML5 drag-and-drop: та спецификация построена на мышиных
 * событиях, и на тач-экранах её нет вовсе (Samsung Internet не поддерживает её ни в
 * одной версии, Safari iOS — только с 15-й). Ручка помечена `touch-none`, поэтому
 * жест с неё не уходит в прокрутку страницы, а захват указателя доводит перенос до
 * конца, даже когда палец ушёл далеко за карточку.
 *
 * Место вставки показывается линией у ближней кромки карточки, а не подсветкой её
 * рамки: рамка отвечала на вопрос «над какой карточкой курсор», но не на главный —
 * «выше или ниже она встанет».
 *
 * Стрелки и Alt+↑/↓ остаются полным путём перестановки: перенос — это удобство, а
 * не единственный способ, и с клавиатуры он недоступен по своей природе.
 */
export function useBlockDrag(reorder: (from: number, to: number) => void, listRef: RefObject<HTMLElement | null>) {
  const [drag, setDrag] = useState<Dragging>(null)
  const bands = useRef<Band[]>([])
  const press = useRef<{ from: number; x: number; y: number } | null>(null)
  /** Последняя позиция указателя в окне — по ней едет автоскролл, пока палец стоит. */
  const clientY = useRef(0)
  const dragging = drag !== null

  // Цель считаем от координаты ДОКУМЕНТА: страница под пальцем едет, полосы карточек
  // при этом остаются на месте, а состав во время переноса не меняется.
  const aim = useCallback((y: number) => {
    const hit = targetAt(bands.current, y + window.scrollY)
    setDrag((d) => (d && hit && (d.over !== hit.over || d.side !== hit.side) ? { ...d, ...hit } : d))
  }, [])

  // Список едет сам, когда указатель у края экрана: карточка шага занимает две трети
  // высоты телефона, и без этого следующая цель просто не помещается на экран.
  useEffect(() => {
    if (!dragging) return
    let frame = 0
    const tick = () => {
      const step = edgeScrollStep(clientY.current, window.innerHeight)
      if (step !== 0) {
        window.scrollBy(0, step)
        aim(clientY.current)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [dragging, aim])

  const stop = () => {
    press.current = null
    setDrag(null)
  }

  return {
    /** Индекс карточки, которую тащат: она бледнеет на своём месте. */
    draggingFrom: drag?.from ?? null,
    /** У какой кромки карточки i рисовать линию (null — не рисовать). */
    lineAt: (i: number): 'before' | 'after' | null => (drag && drag.over === i ? drag.side : null),
    /** Пропсы ручки карточки i. */
    handleProps: (i: number) => ({
      onPointerDown: (e: ReactPointerEvent) => {
        // Правая кнопка открывает меню, а не тащит; у пальца кнопок нет.
        if (e.pointerType === 'mouse' && e.button !== 0) return
        // Иначе мышь начнёт выделять текст карточки прямо во время переноса.
        e.preventDefault()
        press.current = { from: i, x: e.clientX, y: e.clientY }
        clientY.current = e.clientY
        e.currentTarget.setPointerCapture(e.pointerId)
      },
      onPointerMove: (e: ReactPointerEvent) => {
        const from = press.current
        if (!from) return
        clientY.current = e.clientY
        if (!dragging) {
          if (!movedEnough(from.x, from.y, e.clientX, e.clientY)) return
          bands.current = measureBands(listRef.current)
          setDrag({ from: from.from, over: from.from, side: 'before' })
        }
        aim(e.clientY)
      },
      onPointerUp: () => {
        if (drag) reorder(drag.from, dropTargetIndex(drag.from, drag.over, drag.side))
        stop()
      },
      // Системный жест (звонок, шторка) отменяет перенос — состав не трогаем.
      onPointerCancel: stop,
    }),
  }
}
