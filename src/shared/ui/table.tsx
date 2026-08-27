import * as React from 'react'
import { cn } from '@/shared/lib/cn'
import { TEXT } from './control'

/**
 * ПРОСТАЯ ТАБЛИЦА — статический список строк без сортировки и без состояния.
 *
 * Не подменяет `DataTableV2`: та берёт на себя сортировку, скелетоны, пустое состояние
 * и карточки на телефоне, но ради этого тянет TanStack и обязана быть клиентской. На
 * серверной админской странице (события дня, скоркарт, метки) это чистый проигрыш —
 * ради неподвижной таблицы там появлялась бы клиентская граница. Поэтому таблиц две, и
 * граница между ними проходит по одному вопросу: строки шевелятся или нет.
 *
 * Замер 27.08.2026: рукописных таблиц было три, и шапку они рисовали двумя разными
 * способами (`bg-surface-2 text-caption uppercase` против `border-b text-left
 * text-muted`), а обойму — двумя (`overflow-hidden` против `overflow-x-auto`; первый
 * на телефоне ОБРЕЗАЛ таблицу вместо прокрутки).
 *
 * Набор и имена — как у shadcn/ui (Table/TableHeader/TableRow/TableHead/TableCell),
 * чтобы человек, пришедший из любого проекта на shadcn, узнал форму без чтения.
 */

/** Обойма ОБЯЗАТЕЛЬНА: широкая таблица должна прокручиваться внутри себя, а не распирать
 *  страницу. Поэтому она встроена в `Table`, а не оставлена на усмотрение вызывающего. */
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className={cn('w-full', TEXT.bodySm, className)} {...props} />
    </div>
  )
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-surface-2', TEXT.caption, 'uppercase tracking-wide text-muted', className)} {...props} />
}

export function TableBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b border-border last:border-0', className)} {...props} />
}

export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('px-3 py-2 text-left font-semibold', className)} {...props} />
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2 align-top text-ink-2', className)} {...props} />
}
