import Link from 'next/link'
import { cn } from '@/shared/lib/cn'
import { Avatar } from './Avatar'

// Единая строка «аватар + имя + мета» (Ф4 трека ui-system): обвязка
// пересобиралась в 18 файлах, размер аватара принимал девять произвольных
// значений. Размеров ТРИ: xs (мета-строки), sm (авторы/комментарии),
// md (списки людей/таблицы). Мета `at` — уже отформатированная строка
// (timeAgo/дата — на вызывающем: там язык и контекст).

const SIZES = {
  xs: { avatar: 18, text: 'text-[12px]' },
  sm: { avatar: 22, text: 'text-[12.5px]' },
  md: { avatar: 28, text: 'text-[13.5px]' },
} as const

export function UserLine({
  handle,
  name,
  avatarUrl,
  at,
  size = 'sm',
  className,
}: {
  handle: string
  /** Отображаемое имя; без него — @handle. */
  name?: string
  avatarUrl?: string | null
  /** Правая мета (например, timeAgo) — уже отформатированная строка. */
  at?: string
  size?: keyof typeof SIZES
  className?: string
}) {
  const s = SIZES[size]
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', s.text, className)}>
      <Link href={`/${handle}`} className="shrink-0">
        <Avatar handle={handle} avatarUrl={avatarUrl} size={s.avatar} />
      </Link>
      <Link href={`/${handle}`} className="min-w-0 truncate font-medium text-ink hover:text-accent">
        {name ?? `@${handle}`}
      </Link>
      {at && <span className="shrink-0 text-muted">· {at}</span>}
    </span>
  )
}
