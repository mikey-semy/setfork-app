'use client'

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Горизонтально листаемый ряд С ПОДСКАЗКОЙ, что он листается.
 *
 * Полосу прокрутки мы прячем (`no-scrollbar`) — иначе она уродует таб-бары. Но
 * пряча её и не давая ничего взамен, мы получали ряд, который на узком экране
 * выглядит просто ОБРЕЗАННЫМ: у GitHub там стрелки, и человек видит, что дальше
 * что-то есть. Здесь то же самое: затемнение к краю + кнопка-стрелка, и обе
 * появляются ТОЛЬКО когда в ту сторону действительно есть куда листать.
 *
 * Один компонент на все ряды (вкладки списка, вкладки предложения): affordance
 * должен быть одинаковым везде, а не написанным заново под каждый таб-бар.
 */
export function ScrollRow({
  children,
  className = '',
  outerClassName = '',
  scrollerRef,
  label,
}: {
  children: ReactNode
  /** Классы САМОГО скроллера (padding, gap, фон ряда). */
  className?: string
  /** Классы обёртки — отступы ряда снаружи (внутрь их класть нельзя: обрежет). */
  outerClassName?: string
  /** Наружу — для тех, кому нужна геометрия содержимого (переезжающая полоска у TabNav). */
  scrollerRef?: RefObject<HTMLDivElement | null>
  /** Подпись стрелок для скринридера («Вкладки» и т.п.). */
  label: { prev: string; next: string }
}) {
  const own = useRef<HTMLDivElement>(null)
  const ref = scrollerRef ?? own
  const [edges, setEdges] = useState({ left: false, right: false })

  // measure объявлена ВНУТРИ эффекта, а не через useCallback: ref сюда может
  // прийти снаружи (TabNav), и мемоизация по такому ref не сохраняется —
  // React Compiler честно отказывается компилировать компонент целиком.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      // 1px допуск: дробный zoom и субпиксельные ширины иначе оставляют «хвост»,
      // и стрелка висит на до конца долистанном ряду.
      const left = el.scrollLeft > 1
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setEdges((p) => (p.left === left && p.right === right ? p : { left, right }))
    }
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    // Содержимое меняется (счётчики, появление вкладки «Коммиты») — следим за
    // размером, а не только за скроллом: иначе стрелка не появится.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const c of Array.from(el.children)) ro.observe(c)
    return () => {
      el.removeEventListener('scroll', measure)
      ro.disconnect()
    }
  }, [ref])

  const nudge = (dir: -1 | 1) => {
    const el = ref.current
    if (!el) return
    // Листаем на 80% видимой ширины: остаётся «якорь» из прошлого экрана, и не
    // теряется ощущение, где ты был.
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  return (
    <div className={`relative min-w-0 ${outerClassName}`}>
      <div ref={ref} className={`no-scrollbar relative overflow-x-auto ${className}`}>
        {children}
      </div>

      {/* Стрелки поверх краёв. Тач-цель 44px по высоте ряда; на узких экранах
          именно они и есть основной способ добраться до дальних вкладок. */}
      {edges.left && <EdgeButton side="left" onClick={() => nudge(-1)} label={label.prev} />}
      {edges.right && <EdgeButton side="right" onClick={() => nudge(1)} label={label.next} />}
    </div>
  )
}

function EdgeButton({ side, onClick, label }: { side: 'left' | 'right'; onClick: () => void; label: string }) {
  const isLeft = side === 'left'
  return (
    <>
      {/* Затемнение — подсказка «здесь обрыв, а не конец». Не перехватывает тапы. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 w-10 ${
          isLeft ? 'left-0 bg-gradient-to-r' : 'right-0 bg-gradient-to-l'
        } from-surface to-transparent`}
      />
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={`absolute inset-y-0 ${isLeft ? 'left-0' : 'right-0'} grid w-11 place-items-center text-ink-2 hover:text-ink`}
      >
        {isLeft ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>
    </>
  )
}
