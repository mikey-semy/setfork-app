'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * Показывает содержимое ТОЛЬКО на корне списка (вкладка «Список»), а не на
 * под-вкладках (Задачи/Коммиты/Настройки…). Как GitHub: действия репозитория
 * (Watch/Fork/Star) видны на Code, а на под-вкладках — только табы.
 * Шапка живёт в персистентном layout, поэтому фильтруем клиентски по пути.
 */
export function ShowOnListRoot({ base, children }: { base: string; children: ReactNode }) {
  const pathname = usePathname()
  // Корень = ровно /handle/slug (query ?ref=/?find= путь не меняют).
  if (pathname !== base) return null
  return <>{children}</>
}
