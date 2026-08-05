import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

/**
 * Верхняя ссылка «назад к списку» — один примитив вместо трёх одинаковых рецептов.
 *
 * Ровно эта разметка (стрелка + `owner / название`, теми же классами) была скопирована
 * в страницу правки, форка и дерева форков; расходиться ей нельзя — это навигация, и
 * человек ждёт её на одном месте и одного вида (карточка ревью forks/012).
 *
 * Мобильное: строка сжимается до одной (`truncate` + `min-w-0`), а тач-цель добирается
 * до 44px по высоте — ссылка стоит первой на экране, и промах по ней стоит ухода со
 * страницы. Спутник для длинных страниц — `FloatingBack`.
 */
export function BackLink({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 text-[0.8125rem] text-ink-2 hover:text-ink',
        className,
      )}
    >
      <ArrowLeft size={15} className="shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  )
}
