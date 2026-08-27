'use client'

import Link from 'next/link'
import * as React from 'react'
import { cn } from '@/shared/lib/cn'
import { TEXT, TOUCH_MIN_H } from './control'

/**
 * Строка выпадающего меню или списка выбора: действие, вариант, подсказка поиска.
 *
 * Своего примитива у неё не было, хотя рецепт повторялся девять раз в семи файлах
 * (меню действий генерации, редактор меток, подсказки поиска, список моделей,
 * slash-меню редактора). Копии успели разойтись: отступ был `px-2 py-1.5`,
 * `px-3 py-2`, `px-3 py-2.5`, подсветка активной строки — `bg-surface-2` в одних
 * местах и `bg-accent-soft` в других, тач-цель — в одном месте из девяти.
 *
 * Высота строки НЕ из шкалы контролов, и это осознанно: строка меню бывает в две
 * строки текста (название + пояснение), её рост задаёт содержимое. Из шкалы здесь
 * приходит другое — минимальная тач-цель 44px на грубом указателе.
 *
 * Радиус: строка внутри панели с рамкой скругляется мягче панели, иначе углы
 * подсветки торчат за её край.
 */
export function MenuItem({
  active = false,
  href,
  className,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  active?: boolean
  /** Задан — это НАВИГАЦИЯ: строка меню рисуется ссылкой тем же видом (открывается в
   *  новой вкладке, копируется, читается диктором как переход), а не кнопкой с
   *  router.push. Тот же приём, что у `IconButton`: одна роль — один вид, независимо
   *  от того, ведёт строка куда-то или делает что-то здесь. */
  href?: string
}) {
  const shape = cn(
    // eslint-disable-next-line no-restricted-syntax -- строка меню, высота от содержимого
    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-ink-2 transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50',
    TEXT.body,
    TOUCH_MIN_H,
    active && 'bg-surface-2 text-ink',
    className,
  )
  if (href) {
    return <Link href={href} className={shape} {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)} />
  }
  return (
    // Высоту строки МЕНЮ задаёт содержимое (бывает две строки текста), а не ступень
    // шкалы; из шкалы здесь тач-цель. Ровно тот случай, который узда называет
    // исключением: «строка меню — точечный disable с причиной». Девять таких
    // отключений по фичам сведены в одно — здесь.
    <button type="button" className={shape} {...props} />
  )
}
