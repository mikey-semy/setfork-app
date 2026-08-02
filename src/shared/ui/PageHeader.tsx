import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

// Единая шапка страницы/раздела (Ф3 трека ui-system): до неё 48 заголовков h1
// оформлялись 27 разными строками классов (кегль 15..24px, отступ mb-1..mb-6
// или никакого). Поведение — по эталону widgets/ListHeader: flex-wrap,
// min-w-0 + truncate у заголовка, действия справа и не давят текст на мобиле.
// Эталон вживую — /admin/ui-kit.
//
// Кеглей ДВА: 'page' (18px — страницы) и 'section' (16px — разделы внутри).
// Герои-исключения (профиль, лендинг) в шкалу не входят и остаются свои.

export function PageHeader({
  title,
  subtitle,
  icon,
  meta,
  actions,
  hideTitle,
  size = 'page',
  className,
}: {
  title: ReactNode
  /** Подзаголовок-пояснение под шапкой (13px ink-2). */
  subtitle?: ReactNode
  /** Иконка слева от заголовка (акцентный цвет — как сложившийся стиль страниц). */
  icon?: ReactNode
  /** Мелочи справа от заголовка: бейджи, счётчики (не действия). */
  meta?: ReactNode
  /** Действия — правый край ряда; на мобиле переносятся вниз вправо. */
  actions?: ReactNode
  /** Название раздела УЖЕ написано в шапке приложения (TopNav рисует его слева).
   *  Второй раз на странице оно только отжимает контент вниз, но совсем убрать
   *  h1 нельзя: в шапке заголовок — span, а странице нужен заголовок для
   *  скринридеров и структуры документа. Иконка и meta при этом не рисуются —
   *  они подпись к невидимому тексту; подзаголовок и действия остаются. */
  hideTitle?: boolean
  size?: 'page' | 'section'
  className?: string
}) {
  return (
    <header className={cn(hideTitle && !subtitle && !actions ? undefined : 'mb-5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon && !hideTitle && <span className="shrink-0 text-accent">{icon}</span>}
          <h1
            className={cn(
              hideTitle
                ? 'sr-only'
                : 'min-w-0 truncate font-bold text-ink',
              !hideTitle && (size === 'page' ? 'text-[1.125rem]' : 'text-[1rem]'),
            )}
          >
            {title}
          </h1>
          {meta && !hideTitle && <div className="flex shrink-0 items-center gap-2">{meta}</div>}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:justify-end">{actions}</div>
        )}
      </div>
      {subtitle && <p className="mt-1 text-[0.8125rem] text-ink-2">{subtitle}</p>}
    </header>
  )
}
