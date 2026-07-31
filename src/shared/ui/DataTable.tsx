import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

// Единая таблица данных на div-гриде (Ф4 трека ui-system). До неё контейнер
// «overflow-x-auto + шапка-грид + строки-гриды» был скопирован посимвольно
// (CouncilList и FeedSourceList совпадали вплоть до имени const COLS) и ещё
// ×8 в админке. Шаблон колонок и мин-ширина задаются ОДИН раз на контейнере
// и наследуются строками через CSS-переменные — работает в серверных
// компонентах без контекста. Скроллится контейнер, страница — никогда
// (правило мобильной вёрстки).

export function DataTable({
  template,
  minWidth = 720,
  header,
  children,
  className,
}: {
  /** grid-template-columns, напр. 'minmax(0,1fr) 132px 120px 88px'. */
  template: string
  /** Мин-ширина строк до горизонтального скролла контейнера. */
  minWidth?: number
  /** Ячейки шапки (правое выравнивание — className на ячейке вызывающего). */
  header: ReactNode
  /** Строки — DataTableRow. */
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('overflow-x-auto rounded-lg border border-border bg-surface', className)}
      style={{ '--dt-cols': template, '--dt-minw': `${minWidth}px` } as CSSProperties}
    >
      <div className="grid gap-4 border-b border-border px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted [grid-template-columns:var(--dt-cols)] [min-width:var(--dt-minw)]">
        {header}
      </div>
      {children}
    </div>
  )
}

export function DataTableRow({
  children,
  className,
  muted = false,
}: {
  children: ReactNode
  className?: string
  /** Приглушённая строка (выключенная сущность). */
  muted?: boolean
}) {
  return (
    <div
      className={cn(
        'grid items-center gap-4 border-b border-border px-4 py-2.5 last:border-0 hover:bg-surface-2 [grid-template-columns:var(--dt-cols)] [min-width:var(--dt-minw)]',
        muted && 'opacity-60',
        className,
      )}
    >
      {children}
    </div>
  )
}
