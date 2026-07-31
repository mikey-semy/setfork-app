'use client'

import Link from 'next/link'
import { useLayoutEffect, useRef, useState, useTransition } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { cn } from '@/shared/lib/cn'
import { DEFAULT_DETAIL, DETAIL_LEVELS, detailLabel, type DetailLevel } from '@/shared/ai/detail-level'
import { kindLabel, LIST_KINDS, type ListKind } from '@/shared/ai/list-kind'
import { startGeneration } from './actions'

/**
 * Старт генерации как у поисковика: большое поле по центру + «живые» варианты-подсказки.
 * Как только запрос отправлен — поле АНИМАЦИЕЙ спускается вниз (на место чат-инпута), а сверху
 * появляется лоадер. Дальше серверный экшен создаёт генерацию и редиректит на /generate/[id]
 * (GenerationChat), где поле ввода уже внизу — переход читается как продолжение.
 *
 * Спуск — по технике FLIP (замер до/после + инверсия трансформом): центрирование пиксель-в-пиксель
 * во flex, а перелёт в низ — плавным transform без магических величин.
 */

// eslint-disable-next-line no-restricted-syntax -- герой-ввод главной: 15px — прямая пара к SearchField lg, сознательно вне лестницы ролей
const HERO_INPUT = 'max-h-40 min-h-[2.75rem] w-full resize-none bg-transparent px-1.5 py-2 text-[0.9375rem] leading-relaxed text-ink outline-hidden placeholder:text-muted disabled:opacity-70 max-sm:text-[1rem]'

export function GenerateForm({
  lang,
  aiOn,
  defaultQuery,
  suggestions,
  errorKind,
}: {
  lang: Lang
  aiOn: boolean
  defaultQuery: string
  suggestions: string[]
  errorKind?: string
}) {
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const [q, setQ] = useState(defaultQuery)
  const [detail, setDetail] = useState<DetailLevel>(DEFAULT_DETAIL)
  // Тип списка ДО первой генерации: авто-угадывание промахивалось, и нужный тип
  // стоил второй генерации (фидбек владельца). '' = Авто (классификатор по запросу).
  const [kind, setKind] = useState<ListKind | ''>('')
  const [launching, setLaunching] = useState(false)
  const [, start] = useTransition()
  const boxRef = useRef<HTMLDivElement>(null)
  const fromTop = useRef(0)

  // Плейсхолдер детерминирован из props (одинаков на SSR и гидрации — без mismatch): пример из
  // живого списка, если он есть, иначе нейтральная подсказка. Разнообразие даёт сам набор
  // вариантов (заголовки перемешаны на сервере при каждой загрузке).
  // Живой заголовок КАК ЕСТЬ, без приписки «Например:» — плейсхолдер и так читается как
  // пример, а приписка только удлиняла строку и заставляла её переноситься в textarea.
  const example = suggestions[0]
  const placeholder = example ?? say('Describe what you need to do…', 'Опиши, что нужно сделать…')

  // FLIP: после перехода в launching поле уже внизу — инвертируем его к прежнему верху и пускаем
  // плавный перелёт в 0. Замер обоих top по одному элементу (boxRef) — вертикаль без магии.
  useLayoutEffect(() => {
    if (!launching || !boxRef.current) return
    const el = boxRef.current
    const last = el.getBoundingClientRect().top
    const dy = fromTop.current - last
    if (Math.abs(dy) < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    el.style.transition = 'none'
    el.style.transform = `translateY(${dy}px)`
    void el.offsetHeight // форсим reflow, чтобы стартовая позиция применилась без анимации
    el.style.transition = 'transform 560ms cubic-bezier(.22,1,.36,1)'
    el.style.transform = 'translateY(0)'
  }, [launching])

  const launch = (raw: string) => {
    const query = raw.trim()
    if (!query || !aiOn || launching) return
    setQ(query)
    fromTop.current = boxRef.current?.getBoundingClientRect().top ?? 0
    setLaunching(true)
    const fd = new FormData()
    fd.set('q', query)
    fd.set('detail', detail)
    if (kind) fd.set('kind', kind)
    // Даём спуску проиграться до навигации (экшен создаёт генерацию и редиректит быстро).
    window.setTimeout(() => start(() => startGeneration(fd)), 520)
  }

  const errText: Record<string, string> = {
    aifail: t('aiFail', lang),
    ratelimited: t('rateLimited', lang),
    ai_quota: say('Monthly draft limit reached. Try again next month.', 'Исчерпан месячный лимит на черновики. Попробуй в следующем месяце.'),
    // Free-лимит (#308): не ошибка, а апселл Pro — свой акцентный тон.
    free_limit: say(
      'You have reached the free monthly generation limit. Pro removes the limit and unlocks the council (multi-model quality).',
      'Достигнут месячный лимит бесплатных генераций. Pro снимает лимит и открывает «совет» — мультимодельное качество.',
    ),
  }
  const notice: { text: string; tone: 'warn' | 'danger' | 'upsell' } | null = !aiOn
    ? { text: say('Drafting is not configured (no key).', 'Черновики не настроены (нет ключа).'), tone: 'warn' }
    : errorKind && errText[errorKind]
      ? { text: errText[errorKind], tone: errorKind === 'aifail' ? 'danger' : errorKind === 'free_limit' ? 'upsell' : 'warn' }
      : null
  const noticeTone = { warn: 'border-warn/50 text-warn', danger: 'border-border text-danger', upsell: 'border-accent/40 text-ink-2' }

  return (
    <div className={cn('relative flex min-h-[calc(100dvh-53px)] flex-col overflow-hidden px-4 py-4 sm:px-6', launching ? 'justify-end' : 'justify-center')}>
      {/* Уведомления (нет ключа / ошибки) и лоадер — absolute сверху: не влияют на центровку поля. */}
      {notice && !launching && (
        <div className="pointer-events-none absolute inset-x-4 top-4 z-10 sm:inset-x-6">
          <div className={cn('mx-auto max-w-[37.5rem] rounded-md border bg-surface px-3 py-2.5 text-[0.8125rem]', noticeTone[notice.tone])}>
            {notice.text}
          </div>
        </div>
      )}
      {launching && (
        <div className="animate-fadein absolute inset-x-4 top-4 z-10 sm:inset-x-6">
          {/* Спокойный статус вместо мем-заставки: показываем сам запрос и что идёт работа. */}
          <div className="mx-auto flex max-w-[37.5rem] items-center gap-2.5 rounded-lg border border-border bg-surface px-4 py-3">
            <Loader2 size={15} className="shrink-0 animate-spin text-accent" />
            <span className="min-w-0 truncate text-[0.8125rem] text-ink-2">
              {say('Building your list', 'Собираем список')}: <span className="text-ink">{q.trim()}</span>
            </span>
          </div>
        </div>
      )}

      {/* Поле — перелетающий элемент (boxRef). По центру в покое, внизу после старта. */}
      <div ref={boxRef} className="mx-auto w-full max-w-[37.5rem] will-change-transform">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            launch(q)
          }}
          className="flex items-end gap-2 rounded-[1.125rem] border border-border bg-surface px-3 py-2.5 shadow-[0_18px_50px_-24px_rgba(0,0,0,.34)] transition-colors focus-within:border-border-strong"
        >
          <textarea
            name="q"
            autoFocus
            rows={1}
            value={q}
            disabled={launching}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                launch(q)
              }
            }}
            placeholder={placeholder}
            className={HERO_INPUT}
          />
          <button
            type="submit"
            disabled={!q.trim() || !aiOn || launching}
            aria-label={t('generateWithAi', lang)}
            className="grid size-[2.5rem] shrink-0 place-items-center rounded-full bg-primary text-primary-fg transition-opacity disabled:opacity-40"
          >
            {launching ? <Loader2 size={17} className="animate-spin" /> : <ArrowUp size={18} />}
          </button>
        </form>

        {/* Тип списка — ДО генерации: «Авто» угадывает по запросу, явный выбор экономит
            целую генерацию при промахе. На узком экране пилюли переносятся, не прячутся. */}
        {!launching && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[0.78125rem]">
            <button
              type="button"
              onClick={() => setKind('')}
              className={cn(
                'rounded-full border px-2.5 py-[0.1875rem] transition-colors',
                kind === '' ? 'border-(--accent) bg-(--accent-soft) text-accent' : 'border-border text-ink-2 hover:text-ink',
              )}
            >
              {say('Auto', 'Авто')}
            </button>
            {LIST_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  'rounded-full border px-2.5 py-[0.1875rem] transition-colors',
                  kind === k ? 'border-(--accent) bg-(--accent-soft) text-accent' : 'border-border text-ink-2 hover:text-ink',
                )}
              >
                {kindLabel(k, lang === 'ru')}
              </button>
            ))}
          </div>
        )}

        {/* Объём списка. Уровень уезжает в колонку generations.detail, поэтому переживает
            «ещё вариант» — и его же можно переключить потом прямо в чате. */}
        {!launching && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-[0.78125rem]">
            {DETAIL_LEVELS.map((lv) => (
              <button
                key={lv}
                type="button"
                onClick={() => setDetail(lv)}
                className={cn(
                  'rounded-full border px-2.5 py-[0.1875rem] transition-colors',
                  detail === lv ? 'border-(--accent) bg-(--accent-soft) text-accent' : 'border-border text-ink-2 hover:text-ink',
                )}
              >
                {detailLabel(lv, lang === 'ru')}
              </button>
            ))}
          </div>
        )}

        {/* Прошлые черновики: за историей логичнее всего идти отсюда же. */}
        {!launching && (
          <div className="mt-3 text-center">
            <Link href="/generate/history" className="text-[0.78125rem] text-muted hover:text-ink">
              {say('Draft history', 'История генераций')}
            </Link>
          </div>
        )}


        {/* Варианты как у поисковика — «живые» заголовки списков. Клик = отправка. Прячем на старте. */}
        {!launching && suggestions.length > 0 && (
          <div className="animate-fadein mt-4 flex flex-wrap justify-center gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => launch(s)}
                disabled={!aiOn}
                className="rounded-full border border-border bg-surface-2 px-3.5 py-[0.4375rem] text-[0.8125rem] text-ink-2 transition-colors hover:text-ink disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
