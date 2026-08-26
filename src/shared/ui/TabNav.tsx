'use client'

import Link from 'next/link'
import { Children, Fragment, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu'
import { Tooltip } from './Tooltip'
import { ScrollRow } from './ScrollRow'
import { PAGE_X } from './control'

// Единый таб-бар под шапкой (GitHub-стиль) — ОДИН источник правды для профиля,
// страницы списка, Explore и любых будущих разделов. Активная вкладка подчёркнута
// ПЕРЕЕЗЖАЮЩЕЙ полоской.
//
// Два режима ряда:
//  • `arrows` — ряд листается вбок со стрелками (профиль, Explore);
//  • `overflow` — не влезшие вкладки уезжают в «…»-меню в конце ряда (как More
//    у GitHub). Ряд при этом НИКОГДА не листается и не обрезается — на мобиле
//    видно, что вкладок больше, и до них один тап.
//
// Плавность «везде»: SPA-переходы Next не перегружают страницу, но между РАЗНЫМИ
// маршрутами (вкладки списка) компонент ремоунтится. Поэтому последняя позиция
// полоски хранится на уровне модуля (переживает ремоунт в том же JS-контексте):
// первый кадр рисуем на старом месте, затем rAF → переезд к новой вкладке.
const lastPos = new Map<string, { left: number; width: number }>()

/** Переезжающая полоска активной вкладки — общая для обоих режимов ряда. */
function useTabUnderline(scope: string) {
  const ref = useRef<HTMLDivElement>(null)
  const [bar, setBar] = useState<{ left: number; width: number } | null>(() => lastPos.get(scope) ?? null)

  useEffect(() => {
    const nav = ref.current
    const el = nav?.querySelector<HTMLElement>('[data-active="true"]')
    if (!nav || !el) {
      setBar(null)
      lastPos.delete(scope)
      return
    }
    const next = { left: el.offsetLeft, width: el.offsetWidth }
    lastPos.set(scope, next)
    // rAF: первый кадр успевает отрисоваться со старой позицией → CSS-transition едет.
    const raf = requestAnimationFrame(() =>
      setBar((prev) => (prev && prev.left === next.left && prev.width === next.width ? prev : next)),
    )
    return () => cancelAnimationFrame(raf)
  })

  return { ref, bar }
}

function Underline({ bar }: { bar: { left: number; width: number } | null }) {
  if (!bar) return null
  return (
    <span
      aria-hidden
      className="absolute bottom-0 h-[2px] rounded-full bg-accent transition-all dur-base ease-out"
      style={{ left: bar.left, width: bar.width }}
    />
  )
}

interface TabNavBase {
  children: ReactNode
  /** Ключ памяти позиции: табы одного раздела (напр. 'list') анимируются между маршрутами. */
  scope?: string
  /** Центрировать вкладки (витрина Explore); по умолчанию слева (GitHub-стиль). */
  center?: boolean
}

export type TabNavProps = TabNavBase &
  (
    | {
        /** Подписи стрелок листания (режим листаемого ряда). */
        arrows: { prev: string; next: string }
        overflow?: undefined
      }
    | {
        /** Подпись «…»-меню, куда уезжают не влезшие вкладки. */
        overflow: { moreLabel: string }
        arrows?: undefined
      }
  )

export function TabNav(props: TabNavProps) {
  return props.overflow ? (
    <OverflowTabNav
      scope={props.scope}
      center={props.center}
      moreLabel={props.overflow.moreLabel}
    >
      {props.children}
    </OverflowTabNav>
  ) : (
    <ScrollTabNav
      scope={props.scope}
      center={props.center}
      arrows={props.arrows}
    >
      {props.children}
    </ScrollTabNav>
  )
}

function ScrollTabNav({
  children,
  scope = 'default',
  center = false,
  arrows,
}: TabNavBase & { arrows: { prev: string; next: string } }) {
  const { ref, bar } = useTabUnderline(scope)

  return (
    <div className="border-b border-border">
      {/* justify-center-safe (= `safe center`), а НЕ обычный justify-center: когда табы
          шире экрана (мобильный), обычное центрирование уводит первый таб за левый край
          в НЕДОСКРОЛЛИВАЕМУЮ зону — слева край не видно и достать его нельзя. `safe`
          центрирует, пока влезает, а при переполнении ведёт себя как start (прижимает
          влево), и ряд нормально листается. */}
      {/* Ряд листается со стрелками (ScrollRow): пряча полосу прокрутки, надо
          дать взамен подсказку, иначе на узком экране вкладки выглядят просто
          обрезанными и до дальних не догадаться добраться. */}
      <ScrollRow
        scrollerRef={ref}
        label={arrows}
        className={`${PAGE_X} flex gap-1 text-body-lg ${center ? 'justify-center-safe' : ''}`}
      >
        {children}
        <Underline bar={bar} />
      </ScrollRow>
    </div>
  )
}

function flattenTabs(children: ReactNode): ReactElement<TabItemProps>[] {
  return Children.toArray(children).flatMap((c) => {
    if (!isValidElement(c)) return []
    if (c.type === Fragment) return flattenTabs((c.props as { children?: ReactNode }).children)
    return [c as ReactElement<TabItemProps>]
  })
}

// Кнопка «…» = такая же вкладка по метрике ряда (высота, отступы), поэтому классы
// общие: по ним же меряется её ширина в невидимом ряду-призраке.
// ml-auto прижимает её к ПРАВОМУ краю ряда (как More у GitHub), а не лепит к
// последней влезшей вкладке — иначе она читается как ещё одна вкладка.
const moreTabClass =
  'ml-auto inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap px-3 py-2.5 min-w-11'

function OverflowTabNav({
  children,
  scope = 'default',
  center = false,
  moreLabel,
}: TabNavBase & { moreLabel: string }) {
  // Дети — всегда <TabItem>: их пропсы нужны, чтобы отрисовать не влезшие вкладки
  // пунктами меню (в меню это уже не вкладка, а строка со счётчиком). Вкладки часто
  // приходят завёрнутыми в <>…</> (ветки по типу профиля) — фрагменты разворачиваем,
  // иначе весь набор выглядел бы одним узлом без href.
  const items = flattenTabs(children)
  const { ref, bar } = useTabUnderline(scope)
  const ghostRef = useRef<HTMLDivElement>(null)
  // Сколько вкладок влезает в ряд. До первого измерения — все: без JS и на первом
  // кадре ряд полный (лишнее скрыто overflow-hidden, страница вбок не едет).
  const [fit, setFit] = useState(items.length)

  useEffect(() => {
    const row = ref.current
    const ghost = ghostRef.current
    if (!row || !ghost) return
    const GAP = 4 // gap-1
    const measure = () => {
      // Меряем по призраку: в нём ВСЕГДА полный ряд, включая уехавшие в меню
      // вкладки (у скрытых display:none ширины нет — измерить их в самом ряду
      // невозможно). Последний ребёнок призрака — кнопка «…».
      const kids = Array.from(ghost.children) as HTMLElement[]
      if (kids.length < 2) return
      const moreW = kids[kids.length - 1].offsetWidth
      const widths = kids.slice(0, -1).map((c) => c.offsetWidth)
      const avail = row.clientWidth
      let used = 0
      let n = 0
      for (const w of widths) {
        const add = w + (n ? GAP : 0)
        if (used + add > avail) break
        used += add
        n++
      }
      // Не всё влезло → в ряду появится «…», и место под неё надо освободить.
      if (n < widths.length) {
        while (n > 0 && used + GAP + moreW > avail) {
          used -= widths[n - 1] + (n > 1 ? GAP : 0)
          n--
        }
      }
      setFit((prev) => (prev === n ? prev : n))
    }
    measure()
    // Ряд — на ширину экрана, призрак — на содержимое (счётчики растут, вкладка
    // появляется/исчезает). Призраку ОБЯЗАТЕЛЕН w-max: с шириной от родителя он
    // никогда не меняет размер, RO молчит, и замер залипает навсегда.
    const ro = new ResizeObserver(measure)
    ro.observe(row)
    ro.observe(ghost)
    // Шрифт догружается ПОСЛЕ первого замера, и подписи меняют ширину (у фолбэка
    // метрики другие). Без этого ряд остаётся с «влезло 3» при пустой половине.
    let alive = true
    void document.fonts?.ready.then(() => {
      if (alive) measure()
    })
    return () => {
      alive = false
      ro.disconnect()
    }
  }, [ref, items.length])

  const hiddenItems = items.slice(fit)
  const activeIndex = items.findIndex((it) => it.props.on)
  // Активная вкладка уехала в меню → полоска встаёт под «…» (видно, где ты).
  const moreActive = activeIndex >= 0 && activeIndex >= fit

  return (
    <div className="border-b border-border">
      <div className={`${PAGE_X} relative`}>
        <div
          ref={ref}
          className={`relative flex w-full gap-1 overflow-hidden text-body-lg ${center ? 'justify-center' : ''}`}
        >
          {items.slice(0, fit)}
          {hiddenItems.length > 0 && <MoreTab items={hiddenItems} label={moreLabel} active={moreActive} />}
          <Underline bar={bar} />
        </div>
        {/* Ряд-призрак: невидимая копия ПОЛНОГО ряда, по ней и меряем. visibility:hidden
            (не display:none) сохраняет геометрию и убирает ссылки из фокуса и из
            дерева доступности. Вне `ref` — чтобы полоска не нашла активную вкладку тут.
            Обёртка с overflow-hidden ОБЯЗАТЕЛЬНА: absolute-ребёнок шире экрана всё
            равно попадает в прокручиваемую область — без неё страница едет вбок. */}
        <div
          aria-hidden
          className="pointer-events-none invisible absolute inset-x-4 top-0 h-full overflow-hidden"
        >
          <div ref={ghostRef} className="flex w-max gap-1 text-body-lg">
            {items}
            <span className={moreTabClass}>
              <MoreHorizontal size={18} />
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function MoreTab({
  items,
  label,
  active,
}: {
  items: ReactElement<TabItemProps>[]
  label: string
  active: boolean
}) {
  return (
    <DropdownMenu>
      <Tooltip label={label}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-active={active || undefined}
          // Кнопка «…» активна, когда текущая вкладка уехала под неё: для читающего с
          // экрана это единственный признак, что текущее — там.
          aria-current={active ? 'page' : undefined}
          className={`${moreTabClass} ${active ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}
        >
          <MoreHorizontal size={18} />
        </button>
      </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end">
        {items.map((it) => (
          <DropdownMenuItem key={it.props.href} asChild>
            <Link href={it.props.href}>
              <span className={`flex-1 ${it.props.on ? 'font-semibold text-ink' : ''}`}>{it.props.label}</span>
              {it.props.count != null && it.props.count > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-2 px-1.5 text-caption leading-none text-ink-2">
                  {it.props.count}
                </span>
              )}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export interface TabItemProps {
  href: string
  on: boolean
  /** Иконка вкладки (только на широком экране); фильтры-вкладки живут и без неё. */
  icon?: React.ReactNode
  label: string
  count?: number
}

export function TabItem({ href, on, icon, label, count }: TabItemProps) {
  return (
    <Link
      href={href}
      data-active={on || undefined}
      // ТЕКУЩАЯ ВКЛАДКА ОБЪЯВЛЯЕТСЯ, а не только рисуется. `data-active` двигает полоску
      // и меняет начертание — оба признака чисто зрительные, и в скринридере ряд звучал
      // как несколько одинаковых ссылок подряд: «где я» не отвечал никто. `aria-current`
      // — штатный ответ на этот вопрос, и он же у листалки на номере текущей страницы.
      aria-current={on ? 'page' : undefined}
      className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap px-3 py-2.5 ${
        on ? 'font-semibold text-ink' : 'font-medium text-ink-2 hover:text-ink'
      }`}
    >
      {/* Иконка — только на широком экране. На мобиле она съедает ширину, из-за
          которой в ряд не влезает лишняя вкладка, а смысла не добавляет: подписи
          короткие и однозначные (так же у GitHub на узком экране). */}
      {icon != null && <span className={`hidden sm:inline ${on ? 'text-ink' : 'text-muted'}`}>{icon}</span>}
      {label}
      {count != null && count > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-2 px-1.5 text-caption leading-none text-ink-2">
          {count}
        </span>
      )}
    </Link>
  )
}
