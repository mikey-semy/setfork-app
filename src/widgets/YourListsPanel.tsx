'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { SearchField } from '@/shared/ui/SearchField'
import { t, type Lang } from '@/shared/i18n'

export interface YourListItem {
  handle: string
  slug: string
  avatarUrl: string | null
  version: number
}

/** Переиспользуемая панель «Your lists» (dashboard-сайдбар; в drawer — своя
 *  компактная версия в TopNav). Клиентский фильтр по подстроке через SearchField. */
export function YourListsPanel({ items, lang }: { items: YourListItem[]; lang: Lang }) {
  const ru = lang === 'ru'
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const shown = query ? items.filter((l) => `${l.handle}/${l.slug}`.toLowerCase().includes(query)) : items

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{t('yourLists', lang)}</span>
        <Link href="/new" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent hover:underline">
          <Plus size={13} /> {ru ? 'Создать' : 'New'}
        </Link>
      </div>
      {items.length > 5 && (
        <div className="mb-2">
          <SearchField value={q} onValueChange={setQ} placeholder={t('findList', lang)} size="xs" clearLabel={t('clear', lang)} />
        </div>
      )}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted">
          {t('emptyMyLists', lang)}
        </div>
      ) : shown.length === 0 ? (
        <div className="px-2 py-3 text-[12.5px] text-muted">{ru ? 'Ничего не найдено' : 'No matches'}</div>
      ) : (
        <div className="flex flex-col gap-1">
          {shown.map((m) => (
            <Link
              key={`${m.handle}/${m.slug}`}
              href={`/${m.handle}/${m.slug}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-surface"
            >
              <Avatar handle={m.handle} avatarUrl={m.avatarUrl} size={18} />
              <span className="truncate font-semibold text-ink">{m.slug}</span>
              <span className="ml-auto font-mono text-[10.5px] text-muted">v{m.version}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
