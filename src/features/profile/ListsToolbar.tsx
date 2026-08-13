'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { SearchField } from '@/shared/ui/SearchField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import type { Lang } from '@/shared/i18n'
import { buttonClass } from '@/shared/ui/button-style'

/** Тулбар вкладки «Списки» профиля (как шапка репозиториев GitHub): поиск + фильтр
 *  по типу + сортировка + кнопка «Создать». Меняет query-параметры (сбрасывая
 *  страницу), серверная страница уже фильтрует/пагинирует. */
export function ListsToolbar({
  lang,
  isOwner,
  q,
  type,
  sort,
}: {
  lang: Lang
  isOwner: boolean
  q: string
  type: 'all' | 'public' | 'private' | 'forks'
  sort: 'recent' | 'name' | 'stars'
}) {
  const ru = lang === 'ru'
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [query, setQuery] = useState(q)

  function navigate(patch: Record<string, string>) {
    const sp = new URLSearchParams(params.toString())
    sp.set('tab', 'lists')
    for (const [k, v] of Object.entries(patch)) {
      if (v) sp.set(k, v)
      else sp.delete(k)
    }
    sp.delete('page') // смена фильтра → на первую страницу
    router.push(`${pathname}?${sp.toString()}`)
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          navigate({ q: query.trim() })
        }}
        className="min-w-[11.25rem] flex-1"
      >
        <SearchField
          value={query}
          onValueChange={setQuery}
          onClear={() => {
            setQuery('')
            navigate({ q: '' })
          }}
          size="sm"
          placeholder={ru ? 'Найти список…' : 'Find a list…'}
          ariaLabel={ru ? 'Найти список' : 'Find a list'}
        />
      </form>

      <Select value={type} onValueChange={(v) => navigate({ type: v === 'all' ? '' : v })}>
        <SelectTrigger className="w-auto min-w-[6.5rem] gap-1.5">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{ru ? 'Все типы' : 'All types'}</SelectItem>
          <SelectItem value="public">{ru ? 'Публичные' : 'Public'}</SelectItem>
          <SelectItem value="private">{ru ? 'Приватные' : 'Private'}</SelectItem>
          <SelectItem value="forks">{ru ? 'Форки' : 'Forks'}</SelectItem>
        </SelectContent>
      </Select>

      <Select value={sort} onValueChange={(v) => navigate({ sort: v === 'recent' ? '' : v })}>
        <SelectTrigger className="w-auto min-w-[6.5rem] gap-1.5">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="recent">{ru ? 'Недавние' : 'Recent'}</SelectItem>
          <SelectItem value="name">{ru ? 'По имени' : 'Name'}</SelectItem>
          <SelectItem value="stars">{ru ? 'По звёздам' : 'Stars'}</SelectItem>
        </SelectContent>
      </Select>

      {isOwner && (
        <Link
          href="/new"
          className={buttonClass({ className: 'border-transparent bg-accent text-white hover:opacity-90' })}
        >
          <Plus size={15} /> {ru ? 'Создать' : 'New'}
        </Link>
      )}
    </div>
  )
}
