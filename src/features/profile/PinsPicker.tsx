'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { Pencil, Star } from 'lucide-react'
import { OverlayPanel } from '@/shared/ui/OverlayPanel'
import { PickerPanel, PickerRow } from '@/shared/ui/PickerPanel'
import { Button } from '@/shared/ui/button'
import { updatePins } from '@/features/library/actions'
import { t, type Lang } from '@/shared/i18n'
import { TextButton } from '@/shared/ui/TextButton'
import { MAX_PINS } from '@/core/domain/pins'
import { findPinnableLists } from './pin-actions'

/** Строка окна: название уже на языке интерфейса — окно его не переводит. */
export type PinnableList = { id: string; slug: string; title: string; stars: number; pinned: boolean }

/**
 * «Customize your pins» — форма окна GitHub (Edit pinned items): пояснение, что и кому
 * будет видно, поиск, «осталось N», строка = НАЗВАНИЕ и звёзды, «Сохранить» недоступна,
 * пока ничего не изменено.
 *
 * ⚠️ В строке — название, а не slug. Slug — техническая часть адреса, человек его не
 * выбирал и в интерфейсе не видит (правило проекта): окно из одних
 * `vyvody-iz-116-istoriy-chto-derzhit-vzroslogo-v-angli…` не давало узнать собственный
 * список. Slug остаётся в поиске (на сервере) — по нему находят те, кто помнит адрес.
 *
 * Отличие от GitHub: переключателей типа («Repositories / Gists») нет — закреплять у нас
 * можно только списки, выбирать не из чего.
 */
export function PinsPicker({ lists, hasMore, lang }: { lists: PinnableList[]; hasMore: boolean; lang: Lang }) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  // Закреплённых по старым правилам бывает больше шести; окно начинает с тех же шести,
  // что показывает профиль (порядок совпадает), и первое же сохранение приводит флаги в
  // порядок. Иначе «Осталось» ушло бы в минус.
  const initial = useMemo(() => new Set(lists.filter((l) => l.pinned).slice(0, MAX_PINS).map((l) => l.id)), [lists])
  const [sel, setSel] = useState<Set<string>>(initial)
  const [q, setQ] = useState('')
  // Найденное сервером: ищем по ВСЕМ спискам, а не по загруженному окну (см.
  // `findPinnableLists`). `null` — поиска нет, показываем окно.
  const [found, setFound] = useState<{ items: PinnableList[]; hasMore: boolean } | null>(null)
  // Ответы приходят не по порядку: «py» может вернуться позже «python». Номер запроса
  // отсекает устаревший ответ, иначе окно показало бы выдачу по недонабранному слову.
  const seq = useRef(0)

  const toggle = (id: string) =>
    setSel((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else if (n.size < MAX_PINS) n.add(id)
      return n
    })

  // Сохранять нечего, пока выбор совпадает с тем, что уже закреплено (как у GitHub):
  // иначе кнопка обещает действие, которого не будет.
  const changed = sel.size !== initial.size || [...sel].some((id) => !initial.has(id))

  const onSearch = async (v: string) => {
    setQ(v)
    const my = ++seq.current
    if (!v.trim()) return setFound(null)
    const res = await findPinnableLists(v)
    if (my === seq.current) setFound(res)
  }
  const shown = found ? found.items : lists
  const more = found ? found.hasMore : hasMore

  // Закрыть без сохранения — вернуть выбор к закреплённому: иначе следующее открытие
  // показало бы галки, которых на профиле нет.
  const close = () => {
    // Незавершённый поиск не должен заполнить уже сброшенное окно: следующий номер
    // делает его ответ устаревшим (находка авто-ревью).
    seq.current++
    setOpen(false)
    setSel(initial)
    setQ('')
    setFound(null)
  }

  const save = () =>
    start(async () => {
      await updatePins([...sel])
      seq.current++
      setOpen(false)
      setQ('')
      setFound(null)
    })

  if (lists.length === 0) return null

  return (
    <>
      <TextButton tone="accent" onClick={() => setOpen(true)} className="gap-1">
        <Pencil size={11} /> {t('pinsCustomize', lang)}
      </TextButton>
      {/* Шапка одна — у PickerPanel; OverlayPanel без title, иначе два заголовка. */}
      {/* bare: см. StarFolderMenu — поля задаёт выбиралка, линии идут от края до края. */}
      <OverlayPanel open={open} onClose={close} bare className="overflow-hidden">
        <PickerPanel
          title={t('pinsTitle', lang)}
          onClose={close}
          closeLabel={t('close', lang)}
          search={{ value: q, onChange: (v) => void onSearch(v), placeholder: t('pinsFilter', lang), clearLabel: t('clear', lang) }}
          footer={
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption text-muted">
                {t('pinsRemaining', lang).replace('{n}', String(MAX_PINS - sel.size))}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={close}>
                  {t('cancel', lang)}
                </Button>
                <Button variant="primary" onClick={save} disabled={pending || !changed}>
                  {t('pinsSave', lang)}
                </Button>
              </div>
            </div>
          }
        >
          <p className="px-3 py-2 text-caption text-muted">{t('pinsHint', lang).replace('{n}', String(MAX_PINS))}</p>
          {shown.length === 0 ? (
            <p className="px-3 py-2 text-caption text-muted">{t('nothingFound', lang)}</p>
          ) : (
            shown.map((l) => {
              const on = sel.has(l.id)
              const full = !on && sel.size >= MAX_PINS
              return (
                <PickerRow
                  key={l.id}
                  mark="box"
                  selected={on}
                  disabled={pending || full}
                  onClick={() => toggle(l.id)}
                  label={l.title || l.slug}
                  right={
                    <span className="inline-flex items-center gap-1 text-caption text-muted tabular-nums">
                      {l.stars} <Star size={12} aria-hidden />
                    </span>
                  }
                />
              )
            })
          )}
          {more && <p className="px-3 py-2 text-caption text-muted">{t('pinsMore', lang)}</p>}
        </PickerPanel>
      </OverlayPanel>
    </>
  )
}
