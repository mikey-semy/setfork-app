import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

// Оболочка «опасной зоны» и её строки (Ф2 трека ui-system): красная рамка +
// шапка + строки-действия через divide-y. До выноса жила тройным посимвольным
// дублем (settings/DangerZone, library/ListSettingsDanger, transfer/Incoming).

/** Красная рамка с шапкой; children — ActionRow-строки (divide-y внутри). */
export function DangerZone({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('overflow-hidden rounded-lg border border-danger/40', className)}>
      <div className="border-b border-danger/40 bg-danger/5 px-5 py-2.5 text-[13px] font-semibold text-danger">{title}</div>
      <div className="divide-y divide-border px-5">{children}</div>
    </section>
  )
}

/** Строка «заголовок + подпись слева, действие справа» — годится и вне красной
 *  рамки (перенос владения, ряды настроек-действий). На мобиле действие
 *  уходит вниз строкой (flex-wrap), текст не давится. */
export function ActionRow({
  title,
  sub,
  children,
  className,
}: {
  title: ReactNode
  sub?: ReactNode
  /** Правая сторона: кнопка/кнопки действия. */
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 py-4', className)}>
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-ink">{title}</div>
        {sub && <div className="mt-0.5 text-[12.5px] text-ink-2">{sub}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:justify-end">{children}</div>}
    </div>
  )
}
