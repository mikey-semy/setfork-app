'use client'
import Link from 'next/link'
import { Check, ChevronDown } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'

/**
 * Фильтр-дропдаун: кнопка + меню ссылок (навигация по query-параметрам).
 *
 * Переехал из features/issues в shared без изменений: ничего задачного в нём не
 * было, а нужен он и списку предложений.
 */
export function FilterMenu({ label, items }: { label: string; items: { label: string; href: string; active?: boolean }[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-body font-medium text-ink-2 outline-hidden hover:bg-surface-2 hover:text-ink">
        {label} <ChevronDown size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[11.25rem]">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {items.map((it) => (
          <DropdownMenuItem key={it.href} asChild>
            <Link href={it.href} className="flex cursor-pointer items-center justify-between gap-2">
              <span className="truncate">{it.label}</span>
              {it.active && <Check size={14} className="shrink-0 text-accent" />}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
