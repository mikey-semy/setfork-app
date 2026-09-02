'use client'

import Link from 'next/link'
import * as React from 'react'
import { cn } from '@/shared/lib/cn'
import { cardClass } from './card-style'
import { CONTROL_H, CONTROL_PX, CONTROL_TEXT, TOUCH_HIT, type ControlSize } from './control'

/**
 * СЕГМЕНТНЫЙ ПЕРЕКЛЮЧАТЕЛЬ: два-три взаимоисключающих вида одного и того же —
 * «код / список» в сравнении версий, «ru / en» в редакторе лендинга, окно отчёта
 * «7 / 30 / 90 дней», фильтр таблицы, режим темы, язык интерфейса.
 *
 * Замер 27.08.2026: роль жила в восьми местах и своего модуля не имела ВОВСЕ. Разошлось
 * всё, что могло: пилюля сегмента писалась четырьмя рецептами (`rounded px-2.5 py-1`,
 * `rounded-md px-3 py-1.5`, `rounded-md px-2.5` + высота из шкалы, `rounded-full px-2.5
 * py-1`), обойма — тремя (`cardClass inset`, голый `flex gap-1.5`, `rounded-full border
 * p-0.5`), и в одной обойме сегменты были кнопками, в другой ссылками.
 *
 * Счётчик всё это НЕ ВИДЕЛ, и вот почему стоит запомнить: роль размазана по двум тегам
 * (`button` и `Link`) и по двум слоям (`shared/ui` он не считает вовсе). Правило «ищем
 * самопал среди кнопок» такую роль пропускает целиком. Поэтому вместе с модулем заведена
 * узда, которая ищет ПРИЗНАК роли — активный сегмент `bg-primary text-primary-fg` — на
 * любом теге.
 *
 * Доступность. Сегмент-ссылка объявляется `aria-current="page"` (он и есть текущий
 * маршрут), сегмент-кнопка — `aria-pressed`. До сегодняшнего дня из восьми обойм
 * состояние сообщала ОДНА: остальные семь диктор читал как обычный ряд ссылок, и какой
 * вид включён сейчас, человек без зрения не узнавал никак.
 */

type Shape = 'square' | 'pill'

const Ctx = React.createContext<{ size: ControlSize; shape: Shape }>({ size: 'sm', shape: 'square' })

export function SegmentedControl({
  label,
  size = 'sm',
  shape = 'square',
  className,
  children,
}: {
  /** Имя обоймы для диктора: «Вид сравнения», «Язык контента». Ряд без имени звучит
   *  как набор случайных кнопок, а не как выбор одного из. */
  label: string
  size?: ControlSize
  shape?: Shape
  className?: string
  children: React.ReactNode
}) {
  // Значение контекста — через useMemo: без него объект пересоздаётся на каждый рендер
  // обоймы, и КАЖДЫЙ сегмент перерисовывается вместе с ней, даже когда ничего не менялось.
  // Найдено React Doctor.
  const ctx = React.useMemo(() => ({ size, shape }), [size, shape])
  return (
    <Ctx.Provider value={ctx}>
      <div
        role="group"
        aria-label={label}
        // ⚠️ ВЫСОТУ ЗАДАЁТ ОБОЙМА, А НЕ СЕГМЕНТЫ. Раньше сегмент брал ступень шкалы, а
        // обойма добавляла поверх свой отступ и рамку — и в ряду с полем и селектами
        // переключатель выходил на 38px против 32 у соседей (замер на проде, замечание
        // владельца 02.09.2026). Теперь ступень принадлежит обойме: она и стоит в ряду,
        // а сегменты растягиваются внутри неё.
        className={cardClass({
          tone: 'inset',
          pad: 'none',
          className: cn(
            'inline-flex w-fit items-center gap-0.5 p-0.5',
            CONTROL_H[size],
            shape === 'pill' && 'rounded-full',
            className,
          ),
        })}
      >
        {children}
      </div>
    </Ctx.Provider>
  )
}

export function Segment({
  active,
  href,
  className,
  children,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  active: boolean
  /** Задан — сегмент это ПЕРЕХОД (вид живёт в адресе и переживает перезагрузку). */
  href?: string
}) {
  const { size, shape } = React.useContext(Ctx)
  const cls = cn(
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium outline-hidden transition-colors focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50',
    // Высота приходит от обоймы: сегмент занимает её целиком, иначе их сумма
    // (сегмент + отступ + рамка) снова выйдет за ступень шкалы.
    'h-full',

    CONTROL_PX[size],
    CONTROL_TEXT[size],
    shape === 'pill' ? 'rounded-full' : 'rounded-md',
    // Обойма стоит в ряду с полями и кнопками, и растить её нельзя — иначе полоса
    // фильтров на телефоне прыгает по высоте. Значит зона, а не размер.
    TOUCH_HIT,
    active ? 'bg-primary text-primary-fg' : 'text-ink-2 hover:text-ink',
    className,
  )
  if (href) {
    return (
      <Link href={href} aria-current={active ? 'page' : undefined} className={cls} {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </Link>
    )
  }
  return (
    <button type="button" aria-pressed={active} className={cls} {...props}>
      {children}
    </button>
  )
}
