'use client'

import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { ISO_639_1 } from '@/shared/i18n/iso639'
import { AnchoredMenu } from './AnchoredMenu'
import { Button } from './button'
import { PickerPanel, PickerRow } from './PickerPanel'
import { SectionLabel } from './SectionLabel'

/**
 * ВЫБОР ЯЗЫКА СОДЕРЖИМОГО (ADR-0030) — язык оригинала списка и «язык моих списков».
 *
 * Языков — все коды ISO 639-1, и сотня строк одним списком на телефоне неудобна. Поэтому
 * частые языки — сверху, а остальные — поиском в той же панели («другой»), как у выбора ветки:
 * одна шапка, одно поле поиска, один вид строки (`PickerPanel`).
 *
 * Имена — из `Intl.DisplayNames` на языке зрителя, плюс самоназвание языка: белорус найдёт свой
 * язык и как «белорусский», и как «беларуская». Код ищется тоже.
 */

/** Частые языки — выбор продукта, а не стандарта: языки интерфейса и соседей, крупнейшие языки. */
const COMMON = ['en', 'ru', 'uk', 'be', 'kk', 'de', 'es', 'fr', 'it', 'pt', 'pl', 'tr', 'zh', 'ja']

type Row = { code: string; name: string; self: string }

function useRows(lang: Lang): Row[] {
  return useMemo(() => {
    const names = new Intl.DisplayNames([lang], { type: 'language' })
    return ISO_639_1.map((code) => {
      const name = names.of(code) ?? code
      let self = name
      try {
        self = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? name
      } catch {
        /* у языка нет своей локали в ICU — самоназвания нет */
      }
      return { code, name, self }
    }).sort((a, b) => a.name.localeCompare(b.name, lang))
  }, [lang])
}

export function LanguagePicker({
  value: controlled,
  defaultValue = null,
  onChange,
  lang,
  name,
  noneLabel,
}: {
  /** Выбранный код ISO 639-1; `null` — не выбран. Не задан — выбор хранит сам (режим формы). */
  value?: string | null
  /** Начальный выбор в режиме формы. */
  defaultValue?: string | null
  onChange?: (code: string | null) => void
  /** Язык интерфейса — на нём имена языков. */
  lang: Lang
  /** Имя скрытого поля — для отправки выбранного кода обычной формой. */
  name?: string
  /** Подпись пустого выбора («как интерфейс»); не задана — пустой выбор не предлагается. */
  noneLabel?: string
}) {
  const [q, setQ] = useState('')
  const [own, setOwn] = useState<string | null>(defaultValue)
  const value = controlled !== undefined ? controlled : own
  const choose = (code: string | null) => {
    setOwn(code)
    onChange?.(code)
  }
  const rows = useRows(lang)
  const byCode = useMemo(() => new Map(rows.map((r) => [r.code, r])), [rows])
  const needle = q.trim().toLowerCase()
  const match = (r: Row) => !needle || r.code === needle || r.name.toLowerCase().includes(needle) || r.self.toLowerCase().includes(needle)
  const common = COMMON.map((c) => byCode.get(c)).filter((r): r is Row => !!r && match(r))
  const rest = rows.filter((r) => !COMMON.includes(r.code) && match(r))
  const current = value ? byCode.get(value) : undefined
  const caption = current ? current.name : (noneLabel ?? t('lang.notSet', lang))

  const row = (r: Row, close: () => void) => (
    <PickerRow
      key={r.code}
      selected={value === r.code}
      onClick={() => {
        choose(r.code)
        setQ('')
        close()
      }}
      label={
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {r.name}
          {r.self.toLowerCase() !== r.name.toLowerCase() && <span className="text-muted"> · {r.self}</span>}
        </span>
      }
      right={<span className="font-mono text-caption text-muted">{r.code}</span>}
    />
  )

  return (
    <>
      {name && <input type="hidden" name={name} value={value ?? ''} />}
      {/* `max-w-full` — не шире поля: на телефоне кнопка растянута на поле, и панель от его
          левого края шириной 300 вылезала за экран 320 (живой замер: 333 из 320). */}
      <AnchoredMenu
        width={300}
        className="max-w-full"
        button={(toggle) => (
          <Button variant="outline" size="md" onClick={toggle} className="w-full justify-between sm:w-auto sm:min-w-56">
            <span className="min-w-0 truncate">{caption}</span>
            <ChevronDown size={14} className="shrink-0 text-muted" />
          </Button>
        )}
      >
        {(close) => (
          <PickerPanel
            title={t('lang.pickTitle', lang)}
            onClose={close}
            closeLabel={t('close', lang)}
            search={{ value: q, onChange: setQ, placeholder: t('lang.search', lang), clearLabel: t('modelSelect.clearSearch', lang), autoFocus: true }}
          >
            {noneLabel && !needle && (
              <PickerRow
                selected={!value}
                onClick={() => {
                  choose(null)
                  close()
                }}
                label={<span className="text-muted">{noneLabel}</span>}
              />
            )}
            {common.length > 0 && (
              <>
                <SectionLabel className="px-2 pb-1 pt-2">{t('lang.common', lang)}</SectionLabel>
                {common.map((r) => row(r, close))}
              </>
            )}
            {rest.length > 0 && (
              <>
                <SectionLabel className="px-2 pb-1 pt-2">{t('lang.all', lang)}</SectionLabel>
                {rest.map((r) => row(r, close))}
              </>
            )}
            {common.length === 0 && rest.length === 0 && <div className="px-2 py-3 text-body-sm text-muted">{t('lang.notFound', lang)}</div>}
          </PickerPanel>
        )}
      </AnchoredMenu>
    </>
  )
}
