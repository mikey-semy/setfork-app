'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Braces, Check, ChevronDown, X } from 'lucide-react'
import { GnomeAvatar } from '@/shared/ui/GnomeAvatar'
import { Tooltip } from '@/shared/ui/Tooltip'
import { CONTROL_H, CONTROL_PX, CONTROL_TEXT, TEXT } from '@/shared/ui/control'
import { SearchField } from '@/shared/ui/SearchField'
import { t, type Lang } from '@/shared/i18n'

/** Значение-пустышка для «нет модели». */
export const NONE = '__none__'

/** Группа списка = НАШ опыт с моделью, а не вендор: вендор ничего не советует, а опыт советует.
 *  active — стоит на роли прямо сейчас; tried — звали, но сейчас не назначена; fresh — не пробовали. */
export type ModelGroup = 'active' | 'tried' | 'fresh'

/** Кто занимает модель: роль настроек или конкретный специалист. */
export interface OptionHolder {
  kind: 'chat' | 'fallback' | 'embedding' | 'council' | 'gnome'
  /** Готовая подпись: «Основная», «Пул совета #1», имя специалиста. */
  label: string
  /** Что эта роль делает — в тултип. */
  what: string
  avatarUrl?: string
  gnomeId?: string
  /** Позиция в пуле совета, 1-based: порядок там значим (1-я ведёт промежуточные шаги). */
  order?: number
}

/** Наш опыт с моделью — из журнала ai_usage, посчитан и отформатирован на сервере. */
export interface OptionMeta {
  group: ModelGroup
  /** Вызовов за окно статистики. */
  calls?: number
  /** Доля успешных, % (мусорный JSON и таймаут — неуспех). */
  okPct?: number
  /** p95 длительности, готовая строка («4.2с»). */
  p95?: string
  /** Средняя цена ОДНОГО нашего вызова в валюте каталога. */
  ourCost?: string
  /** Суммарный расход за окно (для страницы моделей). */
  spent?: string
  /** Успех ниже порога — модель выведена из ротации совета. */
  quarantined?: boolean
  holders?: OptionHolder[]
  /** Эмбеддинги: ИЗМЕРЕННАЯ мерность и что с ней будет в нашей колонке. Пусто = ещё не мерили. */
  embed?: { text: string; fit: 'exact' | 'truncated' | 'padded'; hint: string }
}

/** id — идентификатор модели (моно), label — человеческое имя (URI не показываем),
 *  family — семейство (бейдж), price — готовая строка цены, priceClass —
 *  цветовой класс (зелёный дёшево / жёлтый средне / красный дорого). */
export type Option = {
  value: string
  id: string
  label?: string
  family?: string
  price?: string
  priceClass?: string
  /** Окно контекста, готовая строка («128k»). */
  context?: string
  /** Модель умеет строгий JSON по схеме. */
  structured?: boolean
  /** Внешняя оценка уровня из каталога провайдера (0 = не опубликована). По ней же
   *  отсекается посредственность при автоподборе пула — значит, она должна быть видна. */
  intelligence?: number
  /** Модель сохранена в настройках, но её НЕТ в каталоге провайдера: снята с обслуживания.
   *  Такой вызов отвечает 404 при исправном ключе — это надо видеть в списке, а не в проде. */
  missing?: boolean
  meta?: OptionMeta
}

const parseCsv = (s: string | undefined): string[] => (s || '').split(',').map((x) => x.trim()).filter(Boolean)

/** Порядок групп: сначала то, что уже работает, в конце — неопробованное. */
const GROUP_ORDER: Record<ModelGroup, number> = { active: 0, tried: 1, fresh: 2 }
const groupOfOpt = (o: Option): ModelGroup => o.meta?.group ?? 'fresh'

function groupTitles(lang: Lang): Record<ModelGroup, string> {
  return {
    active: t('modelSelect.groupActive', lang),
    tried: t('modelSelect.groupTried', lang),
    fresh: t('modelSelect.groupFresh', lang),
  }
}

/** Комбобокс выбора модели: поиск, группы по нашему опыту, цена, наш рейтинг и занятость.
 *  Значение уходит в форму через скрытый input[name].
 *
 *  multiple — выбор нескольких: значение уезжает CSV, выбранное показываем чипами.
 *  ПОРЯДОК ЗНАЧИМ и хранится как порядок выбора (у совета 1-я модель ведёт промежуточные шаги,
 *  остальные раздаются экспертам по кругу) — поэтому список, а не множество, и чипы нумерованы. */
export function ModelSelect({
  name,
  defaultValue,
  options,
  placeholder,
  allowEmpty,
  multiple,
  allowCustom,
  customHint,
  id,
  ru = true,
}: {
  name: string
  defaultValue?: string
  options: Option[]
  placeholder?: string
  allowEmpty?: boolean
  multiple?: boolean
  /** Каталог провайдера не приехал (или модели в нём нет) — id можно ввести прямо в поиске.
   *  Раньше на этот случай поле подменялось голым input: связка выглядела как удалённая
   *  фича выбора моделей. Виджет один, деградирует только наполнение списка. */
  allowCustom?: boolean
  /** Подпись строки свободного ввода, например «Использовать». */
  customHint?: string
  /** id кнопки-триггера: по нему подпись связывается с полем (label htmlFor). */
  id?: string
  ru?: boolean
}) {
  const [values, setValues] = useState<string[]>(() => (multiple ? parseCsv(defaultValue) : defaultValue ? [defaultValue] : []))
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const lang: Lang = ru ? 'ru' : 'en'

  const value = values[0] ?? ''
  const optOf = (v: string) => options.find((o) => o.value === v)
  const labelOf = (v: string) => optOf(v)?.label ?? optOf(v)?.id ?? v

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Поиск идёт по id, имени и семейству; занятость тоже ищется («повар» находит его модель).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hit = (o: Option) =>
      o.id.toLowerCase().includes(q) ||
      o.label?.toLowerCase().includes(q) ||
      o.family?.toLowerCase().includes(q) ||
      o.meta?.holders?.some((h) => h.label.toLowerCase().includes(q))
    const list = q ? options.filter(hit) : options
    // Сортировка стабильная: внутри группы сохраняется порядок, который дал сервер (цена ↑).
    return [...list].sort((a, b) => GROUP_ORDER[groupOfOpt(a)] - GROUP_ORDER[groupOfOpt(b)])
  }, [query, options])

  const titles = groupTitles(lang)
  // Счётчики считаем ОДИН раз: на 336 моделях фильтр внутри map — это 113k проходов на рендер.
  // Заголовки не рисуем вовсе, когда группа одна: журнал пуст → «не пробовали» над всем списком
  // это шум, а не подсказка.
  const counts = useMemo(() => {
    const c = { active: 0, tried: 0, fresh: 0 } as Record<ModelGroup, number>
    for (const o of filtered) c[groupOfOpt(o)] += 1
    return c
  }, [filtered])
  const manyGroups = Object.values(counts).filter((n) => n > 0).length > 1
  const triggerLabel = multiple ? (values.length ? t('modelSelect.selectedCount', lang).replace('{n}', String(values.length)) : '') : labelOf(value)

  // Закрытие по клику вне и фокус в поиск при открытии.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      document.removeEventListener('mousedown', onDown)
      cancelAnimationFrame(id)
    }
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
    else setHighlight(0)
  }, [open])

  const pick = (v: string) => {
    if (multiple) {
      // Тумблер, список НЕ закрываем: обычно отмечают несколько подряд. Новая уходит в КОНЕЦ — порядок значим.
      setValues((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]))
      return
    }
    setValues(v ? [v] : [])
    setOpen(false)
  }

  // Свободный id: показываем, только когда в каталоге нет ровно такого значения —
  // иначе строка дублировала бы обычную опцию.
  const custom = allowCustom ? query.trim() : ''
  const showCustom = custom.length > 0 && !options.some((o) => o.value === custom)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const o = filtered[highlight]
      // Ничего не подошло, но id набран руками — Enter принимает его: с пустым
      // каталогом это единственный способ ввести модель.
      if (o) pick(o.value)
      else if (showCustom) pick(custom)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    // Корень ловит клик-вне; выпадашка позиционируется от ВНУТРЕННЕЙ обёртки — иначе чипы (они тоже
    // в корне) растят его высоту, и список уезжает вниз с каждой выбранной моделью.
    <div ref={rootRef}>
      <input type="hidden" name={name} value={multiple ? values.join(',') : value} />

      <div className="relative">
        <button
          type="button"
          id={id}
          onClick={() => setOpen((v) => !v)}
          className={`flex ${CONTROL_H.md} w-full items-center justify-between gap-2 rounded-md border border-border bg-surface-2 ${CONTROL_PX.md} ${CONTROL_TEXT.md} outline-hidden focus:border-border-strong`}
        >
          <span className={`min-w-0 truncate ${triggerLabel ? `${TEXT.body} text-ink` : 'text-muted'}`}>{triggerLabel || placeholder}</span>
          <ChevronDown size={16} className="shrink-0 text-muted" />
        </button>

        {open && (
          <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded-md border border-border bg-surface shadow-card">
            {/* Поиск — общий SearchField в такой же полосе, как у остальных
                выбиралок: своего поля с лупой и крестиком здесь больше нет. */}
            <div className="border-b border-border p-2">
              <SearchField
                ref={inputRef}
                value={query}
                onValueChange={(v) => {
                  setQuery(v)
                  setHighlight(0)
                }}
                onClear={() => inputRef.current?.focus()}
                onKeyDown={onKeyDown}
                ariaLabel={t('modelSelect.searchLabel', lang)}
                placeholder={t('modelSelect.searchPlaceholder', lang)}
                clearLabel={t('modelSelect.clearSearch', lang)}
                size="sm"
              />
            </div>

            <div className="max-h-[60vh] overflow-y-auto overscroll-contain p-1 sm:max-h-96">
              {allowEmpty && !query && (
                <Row selected={value === ''} highlighted={false} onClick={() => pick('')}>
                  <span className="text-ink-2">—</span>
                </Row>
              )}
              {filtered.map((o, i) => {
                const group = groupOfOpt(o)
                // Заголовок печатаем на первой опции группы: список плоский (по нему ходят
                // стрелками), а группы — разметка над ним, а не отдельная структура.
                const first = i === 0 || groupOfOpt(filtered[i - 1]) !== group
                return (
                  <div key={o.value}>
                    {first && manyGroups && (
                      <div className={`flex items-center gap-2 px-2 pb-1 pt-2 ${TEXT.caption} font-semibold uppercase tracking-wide text-muted`}>
                        <span className="min-w-0 truncate">{titles[group]}</span>
                        <span className="tabular-nums">{counts[group]}</span>
                      </div>
                    )}
                    <Row
                      selected={values.includes(o.value)}
                      highlighted={i === highlight}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => pick(o.value)}
                    >
                      <OptionBody o={o} lang={lang} />
                    </Row>
                  </div>
                )
              })}
              {showCustom && (
                <Row selected={values.includes(custom)} highlighted={false} onClick={() => pick(custom)}>
                  <span className={`truncate ${TEXT.bodySm}`}>
                    {customHint ?? t('modelSelect.use', lang)} <span className="font-mono text-ink-2">{custom}</span>
                  </span>
                </Row>
              )}
              {filtered.length === 0 && !showCustom && (
                <div className={`px-3 py-4 text-center ${TEXT.bodySm} text-muted`}>{t('modelSelect.nothingFound', lang)}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Выбранное: чипы нумерованы, потому что порядок несёт смысл (см. коммент к multiple). */}
      {multiple && values.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {values.map((v, i) => (
            <span key={v} className={`inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 py-1 pl-1.5 pr-1 ${TEXT.caption} text-ink-2`}>
              <span className={`grid size-4 shrink-0 place-items-center rounded-md bg-surface ${TEXT.caption} tabular-nums text-muted`}>{i + 1}</span>
              <span>{labelOf(v)}</span>
              <button
                type="button"
                aria-label={t('modelSelect.remove', lang).replace('{m}', labelOf(v))}
                onClick={() => pick(v)}
                className="grid size-4 shrink-0 place-items-center rounded-md text-muted hover:text-ink"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Содержимое строки: две линии, потому что на 360px в одну они не влезают и начинают
 * выталкивать друг друга. Верхняя — что это и почём (главное), нижняя — наш опыт и кто занял.
 * Техническое (контекст, строгий JSON) прячем до sm: на телефоне это шум.
 */
function OptionBody({ o, lang }: { o: Option; lang: Lang }) {
  const m = o.meta
  const holders = m?.holders ?? []
  const shown = holders.slice(0, 3)
  const rest = holders.length - shown.length
  const hasBottom = Boolean(m?.calls || holders.length || o.context || o.structured)

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`min-w-0 truncate ${TEXT.bodySm}`}>{o.label ?? o.id}</span>
        {o.family && (
          <span className={`shrink-0 rounded-full border border-border bg-surface-2 px-1.5 py-px ${TEXT.caption} text-muted`}>{o.family}</span>
        )}
        {o.missing && (
          <span className={`shrink-0 rounded-full border border-warn px-1.5 py-px ${TEXT.caption} text-warn`}>
            {t('models.notInCatalogShort', lang)}
          </span>
        )}
        {o.price && <span className={`ml-auto shrink-0 pl-2 tabular-nums ${TEXT.caption} ${o.priceClass ?? ''}`}>{o.price}</span>}
      </span>

      {hasBottom && (
        <span className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 ${TEXT.caption} text-muted`}>
          {m?.okPct != null && (
            <Tooltip
              label={`${t('modelSelect.journal', lang).replace('{n}', String(m.calls)).replace('{p}', String(m.okPct))}${m.p95 ? `, p95 ${m.p95}` : ''}${m.ourCost ? `, ${m.ourCost}` : ''}`}
            >
              <span className={`tabular-nums ${m.quarantined ? 'text-danger' : 'text-ok'}`}>
                {m.okPct}% · {m.calls}
              </span>
            </Tooltip>
          )}
          {m?.p95 && <span className="tabular-nums">{m.p95}</span>}
          {m?.ourCost && <span className="tabular-nums">{m.ourCost}</span>}
          {m?.embed && (
            <Tooltip label={m.embed.hint}>
              <span className={`tabular-nums ${m.embed.fit === 'truncated' ? 'text-warn' : ''}`}>{m.embed.text}</span>
            </Tooltip>
          )}
          {o.context && <span className="hidden tabular-nums sm:inline">{o.context}</span>}
          {o.intelligence ? (
            <Tooltip label={t('modelSelect.intelligence', lang)}>
              <span className="hidden tabular-nums sm:inline">{t('modelSelect.iq', lang).replace('{n}', String(o.intelligence))}</span>
            </Tooltip>
          ) : null}
          {o.structured && (
            <Tooltip label={t('models.strictJson', lang)}>
              <span className="hidden sm:inline-flex">
                <Braces size={12} />
              </span>
            </Tooltip>
          )}
          {shown.length > 0 && (
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {shown.map((h) => (
                // span вокруг аватарки обязателен: Tooltip.Trigger отдаёт ref через asChild,
                // а GnomeAvatar — обычный компонент без forwardRef.
                <Tooltip key={`${h.kind}-${h.label}`} label={`${h.label} — ${h.what}`}>
                  <span className="inline-flex items-center">
                    {h.avatarUrl ? (
                      <GnomeAvatar src={h.avatarUrl} size={16} alt={h.label} className="size-4 rounded-full" />
                    ) : (
                      <span className="rounded-full border border-border bg-surface-2 px-1.5 py-px text-ink-2">{h.label}</span>
                    )}
                  </span>
                </Tooltip>
              ))}
              {rest > 0 && <span className="tabular-nums">+{rest}</span>}
            </span>
          )}
        </span>
      )}
    </span>
  )
}

function Row({
  children,
  selected,
  highlighted,
  onClick,
  onMouseEnter,
}: {
  children: React.ReactNode
  selected: boolean
  highlighted: boolean
  onClick: () => void
  onMouseEnter?: () => void
}) {
  // min-h-11 = 44px: строка списка — тач-цель, на мобиле в неё целятся пальцем.
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      // eslint-disable-next-line no-restricted-syntax -- строка выпадающего списка: 44px — высота ПУНКТА, не кнопки
      className={`relative flex min-h-11 w-full cursor-pointer select-none items-center rounded-sm py-2 pl-8 pr-3 text-left ${TEXT.body} text-ink ${
        highlighted ? 'bg-(--accent-soft) text-accent' : ''
      }`}
    >
      {selected && (
        <span className="absolute left-2.5 flex h-3.5 w-3.5 items-center justify-center">
          <Check size={14} />
        </span>
      )}
      {children}
    </button>
  )
}
