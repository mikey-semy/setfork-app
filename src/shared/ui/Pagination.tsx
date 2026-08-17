import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { pageNumbers } from '@/shared/lib/paging'
import { t, type Lang } from '@/shared/i18n'

/**
 * ЛИСТАЛКА — одна на сайт. Правишь здесь — меняется везде.
 *
 * МОДУЛЬ НАМЕРЕННО БЕЗ `'use client'`, и это несущая деталь. Серверные страницы дают ей
 * `makeHref` и получают настоящие ссылки: они переживают отключённый JS, открываются в
 * новой вкладке, копируются и индексируются. Клиентские панели дают `onPage` и получают
 * кнопки. Универсальный модуль попадает в тот бандл, из которого его позвали, поэтому обе
 * роли живут в одном коде — а разошлись бы они мгновенно: до этого листалка на дашборде
 * была отдельной вёрсткой и уже отличалась и размером, и поведением на краях.
 *
 * ДВА РЕЖИМА ПО ТОМУ, ЧТО ИЗВЕСТНО:
 *   `totalPages` — номера страниц (можно прыгнуть на последнюю);
 *   `hasNext`    — только «вперёд/назад», когда общее число не считали намеренно
 *                  (см. probeWindow: `count(*)` на каждый показ дороже самой выдачи).
 *
 * МОБИЛЬНЫЙ ВИД — НЕ УРЕЗАННЫЙ, А ДРУГОЙ. Номера страниц на 390px не помещаются (74
 * страницы — это 74 цели по 32px), поэтому там «‹ 6 / 74 ›» с крупными стрелками, а
 * номера появляются с sm. Переключение — медиазапросом, НЕ замером ширины в JS: замер
 * даёт разный результат на сервере и на клиенте, то есть мигание вёрстки после гидрации
 * на каждой странице сайта.
 */

type Common = {
  page: number
  lang: Lang
  /** Сколько всего страниц. Нет — листалка идёт по `hasNext` без номеров. */
  totalPages?: number
  /** Есть ли следующая страница, когда номеров нет. При заданном `totalPages` не нужен. */
  hasNext?: boolean
  /** Идёт загрузка страницы (клиентский режим): гасим повторные нажатия. */
  busy?: boolean
  /** Компактная — только «‹ N / M ›», без номеров даже на десктопе (узкие панели). */
  compact?: boolean
  className?: string
}

/** Ссылки (серверные страницы) ИЛИ кнопки (клиентские панели) — но не то и другое сразу. */
type Props = Common & ({ makeHref: (page: number) => string; onPage?: never } | { onPage: (page: number) => void; makeHref?: never })

export function Pagination({ page: rawPage, totalPages, hasNext, makeHref, onPage, lang, busy = false, compact = false, className }: Props) {
  const last = totalPages ?? 0
  // Номер приводим к существующему ЗДЕСЬ, а не надеемся на вызывающего: с номером за
  // краем оба шага оказывались мёртвыми, и ряд превращался в тупик. Вызывающие его и так
  // приводят, но чинить это в каждом — то самое расползание, от которого уходили.
  const page = totalPages !== undefined ? Math.min(Math.max(1, rawPage), Math.max(1, last)) : Math.max(1, rawPage)
  const canPrev = page > 1
  const canNext = totalPages !== undefined ? page < last : Boolean(hasNext)
  // Листать некуда — листалки нет. Пустое место под ней читается как «дальше что-то есть».
  if (!canPrev && !canNext) return null

  const box = 'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-2 text-[0.8125rem]'
  const idle = 'border border-border text-ink-2 hover:border-border-strong hover:text-ink'
  const off = 'border border-border/60 text-muted opacity-50'
  const now = 'border border-accent bg-accent/10 font-semibold text-ink'

  /** Шаг листалки: ссылка на сервере, кнопка на клиенте, погашенный край — там же. */
  const step = (to: number, label: string, body: React.ReactNode, current = false, rel?: 'prev' | 'next') => {
    // Край считается ПО ТОМУ, ЧТО ИЗВЕСТНО. С номерами край — это `last`. Без номеров
    // (режим разведчика) верхнего края нет вовсе, и его заменяет `hasNext`: назад можно
    // всегда, вперёд — только если следующая страница есть. Проверять здесь только
    // `totalPages === undefined` мало: тогда «вперёд» оставалась живой ссылкой на
    // несуществующую страницу везде, кроме первой, — а первую спасал лишь общий выход
    // выше, поэтому тест на ней ничего и не замечал.
    const withinBounds = totalPages !== undefined ? to <= last : to < page || hasNext === true
    const live = to !== page && to >= 1 && withinBounds && !busy
    if (!live) {
      // В кнопочном режиме край — настоящая `disabled`-кнопка: она остаётся в дереве
      // доступности как кнопка и объявляется недоступной. Ссылке же нечем быть
      // «выключенной»: `<a>` без href — не ссылка, поэтому там span с aria-disabled.
      return onPage ? (
        <button key={label} type="button" disabled aria-label={label} className={cn(box, current ? now : off)}>
          {body}
        </button>
      ) : (
        <span key={label} aria-disabled aria-current={current ? 'page' : undefined} className={cn(box, current ? now : off)}>
          {body}
        </span>
      )
    }
    if (makeHref) {
      return (
        // rel=prev/next — подсказка обходчику о порядке страниц; prefetch оставлен
        // по умолчанию: следующая страница почти всегда и есть следующее действие.
        <Link key={label} href={makeHref(to)} rel={rel} aria-label={label} aria-current={current ? 'page' : undefined} className={cn(box, idle)}>
          {body}
        </Link>
      )
    }
    return (
      <button key={label} type="button" onClick={() => onPage?.(to)} aria-label={label} aria-current={current ? 'page' : undefined} className={cn(box, idle)}>
        {body}
      </button>
    )
  }

  // Подпись у стрелок — только с sm: на узком экране она съедала бы место, ради которого
  // мобильный вид и заведён, а на десктопе «Назад/Вперёд» читается быстрее значка.
  // Само название шага всегда в aria-label целиком, поэтому текст здесь — оформление.
  const arrow = (icon: React.ReactNode, short: string, side: 'l' | 'r') => (
    <>
      {side === 'l' && icon}
      <span aria-hidden className={cn('hidden', !compact && 'sm:inline')}>
        {short}
      </span>
      {side === 'r' && icon}
    </>
  )
  const prev = step(page - 1, t('prevPage', lang), arrow(<ChevronLeft size={14} />, t('prevPageShort', lang), 'l'), false, 'prev')
  const next = step(page + 1, t('nextPage', lang), arrow(<ChevronRight size={14} />, t('nextPageShort', lang), 'r'), false, 'next')
  // «6 / 74» — узкая форма; без общего числа честнее показать один номер, чем выдумать M.
  // Пока страница едет, ряд обязан это говорить: `busy` только гасит стрелки, и без
  // подписи медленная загрузка выглядит как «нажал, и ничего не произошло».
  const position = (
    <span aria-live="polite" className="min-w-0 shrink-0 truncate px-1 font-mono text-[0.75rem] text-muted">
      {busy ? t('loadingMore', lang) : totalPages !== undefined ? `${page} / ${last}` : page}
    </span>
  )

  return (
    // tabular-nums на всей листалке: иначе номера разной ширины дёргают ряд при переходе.
    <nav className={cn('mt-4 flex items-center justify-center gap-1 tabular-nums', className)} aria-label={t('paginationLabel', lang)}>
      {prev}
      {/* Номера — только когда есть что нумеровать И есть куда их положить. */}
      {totalPages !== undefined && !compact ? (
        <>
          <span className="flex items-center gap-1 sm:hidden">{position}</span>
          <span className="hidden items-center gap-1 sm:flex">
            {pageNumbers(page, last).map((p, i) =>
              p === 'gap' ? (
                // Разрыв — не кнопка: это признак пропуска, нажимать в нём нечего.
                <span key={`gap-${i}`} aria-hidden className="px-1 text-[0.8125rem] text-muted">
                  …
                </span>
              ) : (
                step(p, `${t('pageLabel', lang)} ${p}`, p, p === page)
              ),
            )}
          </span>
        </>
      ) : (
        position
      )}
      {next}
    </nav>
  )
}
