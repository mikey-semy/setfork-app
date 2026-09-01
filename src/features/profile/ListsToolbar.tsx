'use client'

import { useState } from 'react'
import { GitFork } from 'lucide-react'
import { LIST_VISIBILITY_BADGE } from '@/shared/list-visibility'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { SearchField } from '@/shared/ui/SearchField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { t, type Lang } from '@/shared/i18n'
import { buttonClass } from '@/shared/ui/button-style'

/** Общий тулбар вкладок «Списки» и «Звёзды»: одинаковые поиск и сортировка,
 *  дополнительные фильтры и создание — только у собственной библиотеки. */
export function ListsToolbar({
  tab = 'lists',
  lang,
  isOwner,
  q,
  type,
  sort,
  catalogs = [],
  catalog,
  unfiledCount = 0,
  actions,
}: {
  tab?: 'lists' | 'starred'
  lang: Lang
  isOwner: boolean
  q: string
  type: 'all' | 'public' | 'private' | 'draft' | 'forks'
  sort: 'recent' | 'name' | 'stars'
  /** Полки владельца со счётчиками; у чужого профиля фильтр не показываем. */
  catalogs?: { name: string; title: string; count: number }[]
  catalog?: string
  /** Сколько списков ещё не разложено — «Без каталога» и есть очередь разбора. */
  unfiledCount?: number
  /** Действия страницы в том же ряду контролов (например, пакетный Select). */
  actions?: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [query, setQuery] = useState(q)

  function navigate(patch: Record<string, string>) {
    const sp = new URLSearchParams(params.toString())
    sp.set('tab', tab)
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
        className="min-w-field-lg flex-1"
      >
        <SearchField
          value={query}
          onValueChange={setQuery}
          onClear={() => {
            setQuery('')
            navigate({ q: '' })
          }}
          size="md"
          touch="fixed"
          placeholder={tab === 'starred' ? t('searchStarsPh', lang) : t('profile.findList', lang)}
          ariaLabel={tab === 'starred' ? t('searchStarsPh', lang) : t('profile.findListAria', lang)}
        />
      </form>

      {/* Полка: показываем, только когда полки есть или есть что разбирать — пустой
          фильтр на профиле новичка занимал бы место и ничего не объяснял. */}
      {tab === 'lists' && isOwner && (catalogs.length > 0 || unfiledCount > 0) && (
        <Select value={catalog ?? 'all'} onValueChange={(v) => navigate({ catalog: v === 'all' ? '' : v })}>
          <SelectTrigger className="w-auto min-w-26 gap-1.5" aria-label={t('profile.catalogFilter', lang)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('profile.catalogAll', lang)}</SelectItem>
            {unfiledCount > 0 && (
              <SelectItem value="none">
                {t('profile.catalogNone', lang)} <span className="font-mono text-caption text-muted">{unfiledCount}</span>
              </SelectItem>
            )}
            {catalogs.map((c) => (
              <SelectItem key={c.name} value={c.name}>
                <span className="truncate">{c.title || c.name}</span> <span className="font-mono text-caption text-muted">{c.count}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {tab === 'lists' && (
        <Select value={type} onValueChange={(v) => navigate({ type: v === 'all' ? '' : v })}>
          <SelectTrigger className="w-auto min-w-26 gap-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('profile.typeAll', lang)}</SelectItem>
            {/* ⚠️ ТРИ СОСТОЯНИЯ — ТЕ ЖЕ, ЧТО НА КАРТОЧКЕ. Значки и подписи берутся из
                `LIST_VISIBILITY_BADGE`, потому что фильтр и метка обязаны говорить
                одно и то же: пока отбор шёл по полю `visibility`, черновики попадали
                в «Публичные», а «Приватные» отвечали пустотой владельцу, у которого
                514 черновиков. Форк стоит отдельно: это происхождение, а не состояние,
                и форк бывает любым из трёх. */}
            {(['public', 'private', 'draft'] as const).map((state) => {
              const badge = LIST_VISIBILITY_BADGE[state]
              return (
                <SelectItem key={state} value={state}>
                  <span className="flex items-center gap-1.5">
                    <badge.Icon size={13} className="text-muted" />
                    {t(badge.labelKey, lang)}
                  </span>
                </SelectItem>
              )
            })}
            <SelectItem value="forks">
              <span className="flex items-center gap-1.5">
                <GitFork size={13} className="text-muted" />
                {t('profile.typeForks', lang)}
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      )}

      <Select value={sort} onValueChange={(v) => navigate({ sort: v === 'recent' ? '' : v })}>
        <SelectTrigger className="w-auto min-w-26 gap-1.5">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="recent">{t('profile.sortRecent', lang)}</SelectItem>
          <SelectItem value="name">{t('profile.sortName', lang)}</SelectItem>
          <SelectItem value="stars">{t('profile.sortStars', lang)}</SelectItem>
        </SelectContent>
      </Select>

      {tab === 'lists' && isOwner && (
        <Link
          href="/new"
          className={buttonClass({ variant: 'primary' })}
        >
          <Plus size={15} /> {t('profile.newList', lang)}
        </Link>
      )}

      {actions}
    </div>
  )
}
