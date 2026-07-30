'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ListChecks, Lock } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { PickerPanel, PickerRow } from '@/shared/ui/PickerPanel'
import { Tooltip } from '@/shared/ui/Tooltip'
import { Avatar } from '@/shared/ui/Avatar'
import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
import { useRouter } from 'next/navigation'

/**
 * Переключатель списка в бредкрамбе шапки: «▾» рядом с названием открывает списки
 * ТОГО ЖЕ автора, чей список открыт (как «Switch repository» у GitHub), с поиском
 * по всем его спискам. Свои списки сюда не подмешиваются — иначе непонятно, чей
 * это набор.
 *
 * Оболочка общая с выбором ветки и папки (PickerPanel): заголовок, поиск, строки
 * с галкой у текущего. Popover, а НЕ DropdownMenu: в меню Radix перехватывает
 * набор с клавиатуры под свой typeahead, и поле поиска в нём не работает.
 *
 * Данные тянем при ОТКРЫТИИ: в шапке они нужны редко, грузить их на каждой
 * странице заранее — платить за то, чего не открывали.
 */
export interface SwitcherList {
  handle: string
  slug: string
  title: LocaleText
  avatarUrl: string | null
  visibility?: 'public' | 'private'
}

async function fetchLists(handle: string, q: string): Promise<SwitcherList[]> {
  const r = await fetch(`/api/lists/by-owner?h=${encodeURIComponent(handle)}&q=${encodeURIComponent(q)}`)
  const d: { items?: SwitcherList[] } = await r.json()
  return d.items ?? []
}

export function ListSwitcher({
  ownerHandle,
  lang,
  current,
}: {
  ownerHandle: string
  lang: Lang
  /** Открытый сейчас список: всегда в наборе и с галкой — даже если он не попал
   *  в недавние (иначе непонятно, где ты находишься). */
  current: SwitcherList
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [items, setItems] = useState<SwitcherList[]>([])
  const label = t('switchList', lang)
  const activeKey = `${current.handle}/${current.slug}`

  // Один запрос на открытие и на каждый запрос поиска (с задержкой ввода): поиск
  // идёт по ВСЕМ спискам автора, а не по загруженной в шапку горстке.
  useEffect(() => {
    if (!open) return
    let alive = true
    const id = setTimeout(
      () => {
        fetchLists(ownerHandle, q.trim())
          .then((r) => alive && setItems(r))
          .catch(() => {})
      },
      q.trim() ? 200 : 0,
    )
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [open, ownerHandle, q])

  // Текущий — первым, если сервер его не вернул (не влез в набор или ещё грузим).
  // При активном поиске не навязываем: там ожидаешь только совпадения.
  const shown =
    q.trim() || items.some((l) => `${l.handle}/${l.slug}` === activeKey) ? items : [current, ...items]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip label={label}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="grid size-7 shrink-0 place-items-center rounded-md text-ink-2 outline-hidden hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-border-strong"
          >
            <ChevronDown size={14} />
          </button>
        </PopoverTrigger>
      </Tooltip>
      {/* Ширину режем по экрану: на 360px поповер не должен вылезать за край. */}
      <PopoverContent align="start" className="w-[300px] max-w-[calc(100vw-16px)] overflow-hidden p-0">
        <PickerPanel
          title={label}
          onClose={() => setOpen(false)}
          closeLabel={t('close', lang)}
          // Поиск — когда списков больше горстки: на двух-трёх он лишний шум.
          search={
            items.length > 5 || q
              ? { value: q, onChange: setQ, placeholder: t('findList', lang), clearLabel: t('clear', lang) }
              : undefined
          }
        >
          {shown.map((l) => (
            <PickerRow
              key={`${l.handle}/${l.slug}`}
              selected={`${l.handle}/${l.slug}` === activeKey}
              icon={
                l.avatarUrl ? (
                  <Avatar handle={l.handle} avatarUrl={l.avatarUrl} size={18} />
                ) : (
                  <ListChecks size={16} className="shrink-0 text-muted" />
                )
              }
              label={tr(l.title, lang)}
              // Замок = приватный: тот же признак, что в бредкрамбе шапки.
              right={l.visibility === 'private' ? <Lock size={12} className="text-muted" /> : undefined}
              onClick={() => {
                setOpen(false)
                router.push(`/${l.handle}/${l.slug}`)
              }}
            />
          ))}
          {shown.length === 0 && <div className="px-2 py-3 text-[12.5px] text-muted">{t('nothingFound', lang)}</div>}
        </PickerPanel>
      </PopoverContent>
    </Popover>
  )
}
