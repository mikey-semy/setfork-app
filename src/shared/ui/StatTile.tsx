import type { ReactNode } from 'react'
import Link from 'next/link'
import { cn } from '@/shared/lib/cn'
import { SectionLabel } from './SectionLabel'

/**
 * Плитка «подпись + число» — единый вид цифровых сводок в админке (дашборд,
 * страница гнома, дашборд развития). Раньше эта разметка дублировалась в каждом
 * из этих мест локальным <Kpi>.
 *
 * ЧЕСТНОСТЬ (ADR-0005): если источника метрики нет — передают `na` с причиной, и
 * плитка рисует «—» плюс видимую подпись-причину. Причину показываем ТЕКСТОМ, не
 * тултипом: на мобиле ховера нет, а «почему пусто» — это главное, что здесь надо
 * прочитать. Ноль печатаем только когда он правда ноль.
 */
export function StatTile({
  label,
  value,
  na,
  hint,
  href,
  tone = 'ink',
  className,
}: {
  label: ReactNode
  /** Готовая строка значения (форматирование — на вызывающем). Игнорируется при `na`. */
  value?: ReactNode
  /** Причина отсутствия источника. Задана → вместо числа «—» и эта подпись. */
  na?: string
  /** Пояснение под числом (единицы, база сравнения). */
  hint?: string
  href?: string
  tone?: 'ink' | 'accent' | 'warn' | 'ok'
  className?: string
}) {
  const toneClass =
    tone === 'accent' ? 'text-(--accent)' : tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-ink'
  const body = (
    <>
      <SectionLabel>{label}</SectionLabel>
      {na ? (
        <>
          <div className="mt-1.5 text-[22px] font-bold text-muted">—</div>
          <div className="mt-0.5 text-[11.5px] text-muted [overflow-wrap:anywhere]">{na}</div>
        </>
      ) : (
        <>
          <div className={cn('mt-1.5 text-[22px] font-bold tabular-nums', toneClass)}>{value}</div>
          {hint && <div className="mt-0.5 text-[11.5px] text-muted [overflow-wrap:anywhere]">{hint}</div>}
        </>
      )}
    </>
  )
  // min-w-0 — чтобы длинная подпись не растягивала грид и не давала странице h-скролл.
  const shell = cn('min-w-0 rounded-lg border border-border bg-surface p-4', className)
  return href ? (
    <Link href={href} className={cn(shell, 'block hover:border-border-strong')}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  )
}
