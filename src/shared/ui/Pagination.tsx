import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { CONTROL_H, CONTROL_TEXT, TOUCH_MIN_BOX } from './control'
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
 * ТРИ РЕЖИМА ПО ТОМУ, ЧТО ИЗВЕСТНО:
 *   `totalPages` — номера страниц (можно прыгнуть на последнюю);
 *   `hasNext`    — только «вперёд/назад», когда общее число не считали намеренно
 *                  (см. probeWindow: `count(*)` на каждый показ дороже самой выдачи);
 *   `steps`      — KEYSET: номера не существуют вовсе, шаги заданы готовыми адресами.
 *
 * Третий режим — не «ещё один вид», а следствие механики. На пополняемой ленте номер
 * страницы НЕВЫРАЗИМ: смещение считается от начала выдачи, а начало уезжает вниз, пока
 * ленту читают (см. shared/lib/paging, раздел keyset). Показывать там «страница 3»
 * значило бы называть числом то, что числом не является. Поэтому у keyset-режима нет ни
 * номеров, ни подписи «3 / 74» — только два шага, и каждый живёт ровно тогда, когда для
 * него есть адрес.
 *
 * МОБИЛЬНЫЙ ВИД — НЕ УРЕЗАННЫЙ, А ДРУГОЙ. Номера страниц на 390px не помещаются (74
 * страницы — это 74 цели по 32px), поэтому там «‹ 6 / 74 ›» с крупными стрелками, а
 * номера появляются с sm. Переключение — медиазапросом, НЕ замером ширины в JS: замер
 * даёт разный результат на сервере и на клиенте, то есть мигание вёрстки после гидрации
 * на каждой странице сайта.
 */

/** Шаги keyset-режима: готовые адреса. `null` — шага нет (край ленты). */
export type CursorSteps = { prev: string | null; next: string | null }

type Common = {
  page?: number
  lang: Lang
  /** Сколько всего страниц. Нет — листалка идёт по `hasNext` без номеров. */
  totalPages?: number
  /** Есть ли следующая страница, когда номеров нет. При заданном `totalPages` не нужен. */
  hasNext?: boolean
  /** Идёт загрузка страницы (клиентский режим): гасим повторные нажатия. */
  busy?: boolean
  /** Компактная — только «‹ N / M ›», без номеров даже на десктопе (узкие панели). */
  compact?: boolean
  /**
   * Сколько строк подошло под текущий отбор.
   *
   * Показывается ОТДЕЛЬНОЙ строкой над рядом, а не вместо «3 / 26», и это не вкусовщина:
   * ряд отцентрован, и любое изменение его содержимого разъезжает обе стрелки — палец,
   * занесённый над «вперёд», попадает мимо (та же причина, по которой у подписи позиции
   * зарезервирована ширина). Отдельная строка ряда не трогает.
   *
   * Зачем вообще: «3 / 26» отвечает «где я», но не отвечает «сколько нашлось», а при
   * включённом отборе человека интересует именно второе. Передают её те поверхности, у
   * которых счёт и так посчитан ради числа страниц, — лишнего запроса это не стоит.
   */
  total?: number
  className?: string
}

/**
 * Ссылки (серверные страницы) ИЛИ кнопки (клиентские панели) — но не то и другое сразу.
 * Третьим вариантом — keyset: готовые адреса шагов, и тогда номера запрещены типом, а не
 * договорённостью (`page?: never`): передать номер туда, где его не существует, нельзя.
 */
type Props = Common &
  (
    | { page: number; makeHref: (page: number) => string; onPage?: never; steps?: never }
    | { page: number; onPage: (page: number) => void; makeHref?: never; steps?: never }
    | { steps: CursorSteps; page?: never; makeHref?: never; onPage?: never }
  )

export function Pagination({ page: rawPage, totalPages, hasNext, makeHref, onPage, steps, total, lang, busy = false, compact = false, className }: Props) {
  const last = totalPages ?? 0
  // Номер приводим к существующему ЗДЕСЬ, а не надеемся на вызывающего: с номером за
  // краем оба шага оказывались мёртвыми, и ряд превращался в тупик. Вызывающие его и так
  // приводят, но чинить это в каждом — то самое расползание, от которого уходили.
  const raw = rawPage ?? 1
  const page = totalPages !== undefined ? Math.min(Math.max(1, raw), Math.max(1, last)) : Math.max(1, raw)
  // У keyset края заданы не номером, а наличием адреса: нет адреса — нет шага.
  const canPrev = steps ? Boolean(steps.prev) : page > 1
  const canNext = steps ? Boolean(steps.next) : totalPages !== undefined ? page < last : Boolean(hasNext)
  /** Строка «Найдено: N» — сама по себе, без отступов: их расставляет обёртка ниже. */
  const found =
    total === undefined ? null : (
      <div className="text-center text-[0.75rem] text-muted">
        {t('foundLabel', lang)}: <span className="tabular-nums text-ink-2">{total}</span>
      </div>
    )
  // Листать некуда — РЯДА нет: пустое место под ним читается как «дальше что-то есть».
  //
  // А вот счёт остаётся. Первая версия выходила отсюда целиком, и число найденного
  // пропадало ровно там, где оно нужнее всего: отбор сузил выдачу до горстки строк,
  // страница осталась одна — и человек не видит НИ «3 / 26», ни «Найдено: 5». Ради этого
  // случая счёт и заводили.
  if (!canPrev && !canNext) return found && <div className={cn('mt-4', className)}>{found}</div>

  // ВИД по шкале (32px, как у всех контролов), ЦЕЛЬ по стандарту — на грубом указателе
  // шаг дорастает до 44 по обеим сторонам. Руками этого писать нельзя: у проекта для
  // тач-целей есть свои классы, и правило должно жить в одном месте (control.ts).
  /** Ряд обёрнут, только когда есть что показать над ним: лишний узел даром не нужен. */
  const withFound = (row: React.ReactNode) =>
    found ? (
      <div className={cn('mt-4', className)}>
        <div className="mb-1">{found}</div>
        {row}
      </div>
    ) : (
      row
    )
  // Отступ и внешний класс живут НА ОБЁРТКЕ, когда она есть, иначе они удвоились бы.
  const rowClass = cn('flex items-center justify-center gap-1 tabular-nums pointer-coarse:gap-2', found ? null : cn('mt-4', className))

  const box = cn('inline-flex min-w-8 items-center justify-center gap-1 rounded-md px-2', CONTROL_H.md, CONTROL_TEXT.md, TOUCH_MIN_BOX)
  const idle = 'border border-border text-ink-2 hover:border-border-strong hover:text-ink'
  const off = 'border border-border/60 text-muted opacity-50'
  const now = 'border border-accent bg-accent/10 font-semibold text-ink'

  /** Шаг листалки: ссылка на сервере, кнопка на клиенте, погашенный край — там же. */
  const step = (to: number, label: string, body: React.ReactNode, current = false, rel?: 'prev' | 'next') => {
    // ТЕКУЩАЯ СТРАНИЦА — не действие, но объявляться обязана, иначе «где я» держится на
    // одном цвете. Разбор идёт первым и одинаково в обоих режимах: раньше `aria-current`
    // ставила только ссылочная ветка, и в кнопочной текущая страница отличалась лишь
    // начертанием.
    if (current) {
      return (
        <span key={label} aria-current="page" className={cn(box, now)}>
          {body}
        </span>
      )
    }
    // Край считается ПО ТОМУ, ЧТО ИЗВЕСТНО. С номерами край — это `last`. Без номеров
    // (режим разведчика) верхнего края нет вовсе, и его заменяет `hasNext`: назад можно
    // всегда, вперёд — только если следующая страница есть. Проверять здесь только
    // `totalPages === undefined` мало: тогда «вперёд» оставалась живой ссылкой на
    // несуществующую страницу везде, кроме первой, — а первую спасал лишь общий выход
    // выше, поэтому тест на ней ничего и не замечал.
    const withinBounds = totalPages !== undefined ? to <= last : to < page || hasNext === true
    // `busy` НЕ входит в `live`, и это не мелочь. Пока страница едет, только что нажатая
    // стрелка перерисовывалась как `disabled`, браузер снимал с неё фокус и ронял его в
    // <body> — на клавиатуре и в скринридере место терялось при КАЖДОМ перелистывании, а
    // сообщение об ошибке потом некому было объявить. Повторное нажатие и так отсекает
    // `goToPage`, поэтому здесь достаточно сказать «занято», не забирая фокус.
    const live = to !== page && to >= 1 && withinBounds
    if (!live) {
      // КРАЙ В КНОПОЧНОМ РЕЖИМЕ — `aria-disabled`, а НЕ `disabled`. Настоящий `disabled`
      // выкидывает элемент из порядка обхода, и когда ты долистал до последней страницы,
      // браузер снимал фокус с только что нажатой стрелки и ронял его в <body>: место в
      // панели терялось ровно в награду за то, что дошёл до конца. С `aria-disabled`
      // кнопка остаётся под фокусом и объявляется недоступной, а нажатие не делает
      // ничего, потому что обработчика на ней нет.
      //
      // В ссылочном режиме гасить нечего: `<a>` без href — не ссылка. Погашенная стрелка
      // там ПРЯЧЕТСЯ от скринридера целиком: она не действие и ничего не сообщает, а
      // безымянный значок в ленте объявляемых элементов — это шум. «Где я» и «куда можно»
      // читаются по номерам и `aria-current`.
      return onPage ? (
        <button key={label} type="button" aria-disabled="true" aria-label={label} className={cn(box, off)}>
          {body}
        </button>
      ) : (
        <span key={label} aria-hidden className={cn(box, off)}>
          {body}
        </span>
      )
    }
    if (makeHref) {
      return (
        // rel=prev/next — подсказка обходчику о порядке страниц.
        //
        // ПРЕДЗАГРУЗКА — ТОЛЬКО У «ВПЕРЁД». По умолчанию Next тянет payload у каждой
        // ссылки в поле зрения, а номеров в ряду до семи: один показ листалки
        // превращался бы в семь загрузок целых страниц ради одного перехода.
        //
        // «Назад» из предзагрузки ИСКЛЮЧЕНА намеренно. На неё приходят, уже побывав на
        // предыдущей странице, — то есть её payload у браузера есть, и вторая загрузка
        // ничего не ускоряет, а трафик тратит на каждом показе листалки. Дальше по ленте
        // человек идёт вперёд, и предзагружать имеет смысл ровно это направление.
        <Link
          key={label}
          href={makeHref(to)}
          rel={rel}
          prefetch={rel === 'next' ? undefined : false}
          aria-label={label}
          aria-current={current ? 'page' : undefined}
          className={cn(box, idle)}
        >
          {body}
        </Link>
      )
    }
    return (
      <button
        key={label}
        type="button"
        onClick={() => onPage?.(to)}
        aria-label={label}
        aria-current={current ? 'page' : undefined}
        aria-disabled={busy || undefined}
        className={cn(box, idle, busy && 'opacity-50')}
      >
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
  if (steps) {
    // Шаг keyset: адрес есть — ссылка, нет — НИЧЕГО.
    //
    // Здесь мы намеренно расходимся с номерным режимом, где край рисуется погашенным.
    // Там погашенная стрелка временна: шагнул — и она ожила, а держат её ради постоянной
    // ширины ряда с номерами. У keyset ни номеров, ни ряда нет, и отсутствующий шаг
    // отсутствует НАСОВСЕМ, пока читатель не уйдёт вперёд. Вечно мёртвый значок — это
    // обещание действия, которого не будет.
    const cursorStep = (href: string | null, label: string, body: React.ReactNode, rel: 'prev' | 'next') =>
      href ? (
        // Предзагрузка — по тому же правилу, что у номерного режима: только «вперёд».
        <Link key={label} href={href} rel={rel} prefetch={rel === 'next' ? undefined : false} aria-label={label} className={cn(box, idle)}>
          {body}
        </Link>
      ) : null
    return withFound(
      <nav className={rowClass} aria-label={t('paginationLabel', lang)}>
        {/* Объявляем ТОЛЬКО загрузку. Номера страницы здесь нет, и выдумывать его для
            скринридера нельзя: «страница 3» на ленте, у которой начало уезжает, — это
            неверные сведения, а не удобство. */}
        <span className="sr-only" aria-live="polite">
          {busy ? t('loadingMore', lang) : ''}
        </span>
        {cursorStep(steps.prev, t('prevPage', lang), arrow(<ChevronLeft size={14} />, t('prevPageShort', lang), 'l'), 'prev')}
        {cursorStep(steps.next, t('nextPage', lang), arrow(<ChevronRight size={14} />, t('nextPageShort', lang), 'r'), 'next')}
      </nav>,
    )
  }

  const prev = step(page - 1, t('prevPage', lang), arrow(<ChevronLeft size={14} />, t('prevPageShort', lang), 'l'), false, 'prev')
  const next = step(page + 1, t('nextPage', lang), arrow(<ChevronRight size={14} />, t('nextPageShort', lang), 'r'), false, 'next')
  // «6 / 74» — узкая форма; без общего числа честнее показать один номер, чем выдумать M.
  // Пока страница едет, ряд обязан это говорить: `busy` только гасит стрелки, и без
  // подписи медленная загрузка выглядит как «нажал, и ничего не произошло».
  // Ширина ЗАРЕЗЕРВИРОВАНА: ряд отцентрован, и подпись, вырастая с «6 / 74» до
  // «Загрузка…», разъезжала бы обе стрелки наружу — ровно в тот момент, когда палец уже
  // занесён над одной из них. `shrink-0` с `truncate` тут были заодно бессмысленны:
  // несжимаемому элементу нечего усекать, он просто вылезал бы за узкую панель.
  const position = (
    <span className="min-w-[4.5rem] px-1 text-center font-mono text-[0.75rem] text-muted">
      {busy ? t('loadingMore', lang) : totalPages !== undefined ? `${page} / ${last}` : page}
    </span>
  )
  // ЖИВАЯ ОБЛАСТЬ ОТДЕЛЬНО И ВСЕГДА В ДЕРЕВЕ. Раньше `aria-live` висел на видимой подписи,
  // а она с sm уходит в `display:none` ради номеров — то есть на десктопе смена страницы и
  // загрузка не объявлялись вовсе. Скрытый узел от разрешения экрана не зависит.
  const announce = (
    <span className="sr-only" aria-live="polite">
      {busy ? t('loadingMore', lang) : `${t('pageLabel', lang)} ${page}${totalPages !== undefined ? ` / ${last}` : ''}`}
    </span>
  )

  return withFound(
    // tabular-nums на всей листалке: иначе номера разной ширины дёргают ряд при переходе.
    // gap на грубом указателе шире: цели по 44px, стоящие в 4px друг от друга, дают
    // промах в соседнюю страницу — Material требует не меньше 8dp зазора, и это тот же
    // довод, что записан у TOUCH_HIT_ROW про столбики.
    <nav className={rowClass} aria-label={t('paginationLabel', lang)}>
      {announce}
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
    </nav>,
  )
}
