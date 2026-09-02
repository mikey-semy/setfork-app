'use client'

import { useRef, useState } from 'react'
import { ChevronDown, ListChecks } from 'lucide-react'
import { LIST_VISIBILITY_BADGE, type ListVisibilityState } from '@/shared/list-visibility'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { PickerPanel, PickerRow } from '@/shared/ui/PickerPanel'
import { Tooltip } from '@/shared/ui/Tooltip'
import { Avatar } from '@/shared/ui/Avatar'
import { IconButton } from '@/shared/ui/IconButton'
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
  /** Состояние, а не поле БД: черновик закрыт так же, как приватный (list-visibility). */
  visibility?: ListVisibilityState
}

async function fetchLists(handle: string, q: string): Promise<SwitcherList[]> {
  const r = await fetch(`/api/lists/by-owner?h=${encodeURIComponent(handle)}&q=${encodeURIComponent(q)}`)
  // fetch не отвергает промис на 4xx/5xx: без этой проверки тело ошибки разбиралось бы
  // как успешный ответ и панель молча показывала бы пустой список.
  if (!r.ok) throw new Error(`by-owner: HTTP ${r.status}`)
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
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const label = t('switchList', lang)
  const activeKey = `${current.handle}/${current.slug}`

  // Значок состояния в строке. Подпись нативным title: строка сама кнопка,
  // вкладывать в неё триггер тултипа нельзя.
  const visIcon = (state: ListVisibilityState | undefined) => {
    if (!state) return undefined
    const { Icon, labelKey } = LIST_VISIBILITY_BADGE[state]
    const visLabel = t(labelKey, lang)
    // span без роли не может нести aria-label (aria-prohibited-attr) — иконке нужна role="img".
    return (
      // Имя значку даёт aria-label; нативный title его дублировал и на пальце не
      // показывался вовсе. Подсказка тут не нужна: подпись видимости стоит рядом.
      <span role="img" aria-label={visLabel} className="shrink-0 text-muted">
        <Icon size={12} />
      </span>
    )
  }

  // Грузим В ОТВЕТ НА СОБЫТИЕ (открытие панели, ввод в поиске), а не эффектом на
  // изменение состояния: у эффекта тут нет внешней системы, с которой он
  // синхронизируется, — есть действие пользователя. Так нет ни гонок «эффект против
  // эффекта», ни двойного запроса на маунте (react-doctor: no-fetch-in-effect).
  //
  // Сброс при смене автора эффектом тоже не нужен: TopNav монтирует переключатель с
  // key={handle}, поэтому у другого автора это уже другой компонент с чистым
  // состоянием (react-doctor: no-adjust-state-on-prop-change).
  const load = (query: string) => {
    if (timer.current) clearTimeout(timer.current)
    const run = () => {
      fetchLists(ownerHandle, query.trim())
        .then((r) => {
          setItems(r)
          setFailed(false)
        })
        .catch(() => {
          // Молча пустой список = «у автора нет списков», это ложь. Показываем сбой.
          setItems([])
          setFailed(true)
        })
    }
    if (!query.trim()) run()
    else timer.current = setTimeout(run, 200)
  }

  // ОТКРЫТЫЙ СПИСОК — ВСЕГДА ПЕРВОЙ СТРОКОЙ (как «Switch repository» у GitHub).
  // Раньше он вставлялся наверх только когда сервер его не вернул, а в обычном случае
  // оставался там, куда его положила сортировка по свежести, — то есть галка оказывалась
  // в середине и «где я сейчас» приходилось искать глазами.
  //
  // При активном поиске список не навязываем: там ожидаешь только совпадения. Но если он
  // сам попал в совпадения — всё равно наверх, чтобы правило было одно.
  //
  // Наверх ставим строку ОТ СЕРВЕРА, если он её вернул, и только иначе — синтетическую
  // из пропа: у той нет аватара, а видимость в ней неизвестна, пока не ответил роут
  // названия. Подменять ею настоящую строку значит терять аватар и рисовать приватному
  // списку глобус поверх пришедшего с сервера `private` (замечание авто-ревью).
  const fetched = items.find((l) => `${l.handle}/${l.slug}` === activeKey)
  const rest = items.filter((l) => `${l.handle}/${l.slug}` !== activeKey)
  const shown = q.trim() && !fetched ? rest : [fetched ?? current, ...rest]

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) load(q)
      }}
    >
      <Tooltip label={label}>
        <PopoverTrigger asChild>
          <IconButton size="sm" variant="ghost" label={label} className="shrink-0 text-ink-2 outline-hidden hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-border-strong">
            <ChevronDown size={14} />
          </IconButton>
        </PopoverTrigger>
      </Tooltip>
      {/* Ширину режем по экрану: на 360px поповер не должен вылезать за край. */}
      <PopoverContent align="start" className="w-panel-lg cap-viewport overflow-hidden p-0">
        <PickerPanel
          title={label}
          onClose={() => setOpen(false)}
          closeLabel={t('close', lang)}
          // Поиск — когда списков больше горстки: на двух-трёх он лишний шум.
          search={
            items.length > 5 || q
              ? {
                  value: q,
                  onChange: (v: string) => {
                    setQ(v)
                    load(v)
                  },
                  placeholder: t('findList', lang),
                  clearLabel: t('clear', lang),
                }
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
              // Состояние показываем У КАЖДОЙ строки, а не только у приватных: раньше
              // отсутствие замка означало сразу и «публичный», и «мы не знаем» — по такой
              // подписи нельзя понять, что список открыт всему свету.
              right={visIcon(l.visibility)}
              onClick={() => {
                setOpen(false)
                router.push(`/${l.handle}/${l.slug}`)
              }}
            />
          ))}
          {shown.length === 0 && (
            <div className="px-2 py-3 text-body-sm text-muted">
              {failed ? t('loadFailed', lang) : t('nothingFound', lang)}
            </div>
          )}
        </PickerPanel>
      </PopoverContent>
    </Popover>
  )
}
