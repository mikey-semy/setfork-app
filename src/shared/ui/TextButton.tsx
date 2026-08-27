'use client'

import Link from 'next/link'
import * as React from 'react'
import { cn } from '@/shared/lib/cn'
import { TEXT, TOUCH_HIT, TOUCH_HIT_ROW } from './control'

/**
 * ТИХОЕ ДЕЙСТВИЕ ТЕКСТОМ: «Убрать обложку», «Заново», «Сбросить», «+ Добавить пункт»,
 * «Пожаловаться». Не кнопка-плашка и не ссылка-переход — действие здесь и сейчас,
 * которое обязано выглядеть скромнее соседей и не занимать высоту контрола.
 *
 * Почему отдельный примитив, а не `Button variant="ghost"`. У кнопки высота приходит
 * из шкалы (28/32/36/40/44px) и она права: плашка обязана стоять в ряд с полем и
 * селектом. Тихое действие живёт ВНУТРИ строки — в конце ряда по `ml-auto`, в подписи
 * поля, посреди предложения («предлагаем: my-list-2»). Дай ему высоту контрола — и
 * строка распухнет, а `ml-auto` уедет. Тот же раскол есть у всех: у shadcn это
 * `variant="link"`, у Primer — компонент `Link`, а не вариант `Button`.
 *
 * Замер 27.08.2026 (`scripts/ui-parity.mjs`): рецепт встретился 14 раз в 12 файлах и
 * все 14 разошлись — цвет писали пятью способами (`text-accent hover:underline`,
 * `text-muted hover:text-ink`, `text-muted hover:text-accent`, `text-ink-2
 * hover:text-accent`, `text-muted hover:text-ink-2`), кольцо фокуса было у нуля из
 * четырнадцати, тач-цель — у одного. То есть с клавиатуры эти действия были не видны
 * вовсе, а пальцем попадали в 13-пиксельную надпись.
 *
 * Оттенков ровно три, по СМЫСЛУ, а не по цвету: `accent` — предложение (нажми меня),
 * `muted` — служебное (сбросить, заново), `danger` — снос. Расхождения вроде
 * «приглушённый, но при наведении акцентный» специально сведены: разный цвет одного
 * и того же намерения — это и был шум.
 */
export type TextButtonTone = 'accent' | 'muted' | 'danger'

const TONES: Record<TextButtonTone, string> = {
  accent: 'text-accent hover:underline',
  muted: 'text-muted hover:text-ink',
  danger: 'text-muted hover:text-danger',
}

const SIZES = {
  caption: TEXT.caption,
  sm: TEXT.bodySm,
  md: TEXT.body,
} as const

type Props = {
  tone?: TextButtonTone
  size?: keyof typeof SIZES
  /** Как добирается тач-цель 44px. `hit` — зона растёт вверх-вниз, места не занимает
   *  (действие одно в строке). `row` — с резервом места, для стоящих в СТОЛБИК: без
   *  резерва зона верхнего накрывает нижнего и палец жмёт не то. `none` — когда
   *  действие стоит посреди предложения и рвать межстрочье нельзя. */
  touch?: 'hit' | 'row' | 'none'
  /** Задан — это переход, и рисуется он ссылкой: открывается в новой вкладке,
   *  копируется, диктору читается переходом. Тот же приём, что у `IconButton`. */
  href?: string
  /** `submit` — только явным пропом, ровно как у `Button`. Тихое действие внутри формы
   *  бывает и настоящей отправкой («запросить проверку» посреди фразы), но по умолчанию
   *  оно ничего не отправляет. */
  type?: 'button' | 'submit'
  className?: string
}

const TOUCH = { hit: TOUCH_HIT, row: TOUCH_HIT_ROW, none: '' }

export function TextButton({ tone = 'muted', size = 'sm', touch = 'hit', href, type = 'button', className, ...props }: Props & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'>) {
  const shape = cn(
    'inline-flex items-center gap-1.5 rounded-sm text-left outline-hidden transition-colors focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50',
    SIZES[size],
    TONES[tone],
    TOUCH[touch],
    className,
  )
  if (href) {
    return <Link href={href} className={shape} {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)} />
  }
  // Дефолт "button": тихое действие сплошь и рядом стоит внутри формы («сбросить
  // адрес», «предложить слаг»), и дефолтный submit отправлял бы её по нажатию.
  // eslint-disable-next-line react/button-has-type -- примитив безопасен по построению: дефолт задан в сигнатуре, submit — только явным пропом
  return <button type={type} className={shape} {...props} />
}
