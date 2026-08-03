'use client'

import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { Tooltip } from './Tooltip'
import { clampedBottom, useViewportBottom } from './use-viewport-bottom'

const SIZE = 40 // h-10 — сама кнопка; нужна, чтобы не улететь за верх экрана
const GAP = 16

/** Плавающая кнопка «наверх». Появляется после прокрутки вниз (полезно на длинных
 *  списках/курсах). Уважает prefers-reduced-motion. Скрыта при печати. */
export function ScrollToTop({ label = 'Наверх' }: { label?: string }) {
  const [show, setShow] = useState(false)
  // На страницах с липким полем ввода (чат генерации) кнопка в правом нижнем углу
  // налезала на кнопку отправки (фидбек владельца). Фикс-отступ 86px не спасал —
  // композер с чипами/многострочным вводом выше. Меряем РЕАЛЬНУЮ высоту бара и
  // садимся ровно над ним (+16px зазор). ResizeObserver — на рост поля при вводе.
  // Тем же признаком помечен чат раскопок: на десктопе кнопка пряталась ЗА его
  // панелью (фидбек владельца 03.08.2026) — теперь садится над ней.
  const [barH, setBarH] = useState(0)
  // Сама панель как элемент: её ищет один эффект, а МЕРИТ другой. Раньше и поиск, и
  // подписка жили в одном колбэке — наблюдатель создавался внутри measure(), и по
  // коду было не видно, что он освобождается (находка React Doctor: подписка в
  // useEffect без явного cleanup рядом). Разделение чинит и это, и прежнюю дыру:
  // наблюдатель размера создаётся ПОД КОНКРЕТНУЮ панель, когда она появилась.
  const [bar, setBar] = useState<HTMLElement | null>(null)
  // Поправка на расхождение layout/visual viewport: без неё кнопка «прижата к низу
  // страницы», а на экране висит посередине (жалоба владельца по мобиле).
  const { gap, visibleHeight } = useViewportBottom()

  useEffect(() => {
    const findBar = () => setBar(document.querySelector<HTMLElement>('[data-sticky-input]'))
    const onScroll = () => {
      setShow(window.scrollY > 600)
      findBar()
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    // Панель может ПОЯВИТЬСЯ позже (полоса сохранения выезжает, когда форму тронули,
    // чат раскопок — по клику на кирку). Без наблюдения за DOM кнопка «наверх»
    // переехала бы только на следующем скролле — то есть ровно в тот момент, когда
    // она уже налезла на «Сохранить».
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(findBar) : null
    mo?.observe(document.body, { childList: true, subtree: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      mo?.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!bar) {
      setBarH(0)
      return
    }
    // Высота панели меняется и без правок DOM-структуры: растёт поле ввода, приходит
    // ответ в чат. Поэтому именно ResizeObserver, а не разовый замер.
    const measure = () => setBarH(bar.offsetHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [bar])

  if (!show) return null
  // Над нижней панелью (если она есть) и над видимым низом; выше кромки экрана не уходим.
  const desired = gap + (barH ? barH + GAP : 20)
  const bottom = visibleHeight ? clampedBottom({ desired, visibleHeight, selfSize: SIZE, margin: GAP }) : desired
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
          window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
        }}
        style={bottom === 20 ? undefined : { bottom }}
        className={`fixed right-5 z-40 grid h-10 w-10 place-items-center rounded-full border border-border bg-surface text-ink-2 shadow-card transition-colors hover:border-border-strong hover:text-ink print:hidden ${bottom === 20 ? 'bottom-5' : ''}`}
      >
        <ArrowUp size={18} />
      </button>
    </Tooltip>
  )
}
