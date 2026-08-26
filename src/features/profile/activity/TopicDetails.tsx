'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { fill, t, tr, type Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { IconButton } from '@/shared/ui/IconButton'
import { Meter } from '@/shared/ui/Meter'
import { Skeleton } from '@/shared/ui/Skeleton'
import { fmtNumber } from '@/shared/lib/count'
import { dayMonthYear } from '@/shared/lib/date'
import { useDetails, type Details } from './use-details'
import type { ActivityKind, DetailsPage, ListEvent, TopicList } from './types'

// Второй и третий уровни ленты: раскрытая тема показывает списки, в которых шла
// работа (с долей от самого нагруженного), раскрытый список — сами события.

/** Списки темы: перечень приезжает раскрытием, а не первым ответом страницы. */
export function TopicLists({ handle, kind, windowKey, lang }: { handle: string; kind: ActivityKind; windowKey: string; lang: Lang }) {
  const details = useDetails<TopicList>(handle, { kind, windowKey })
  const items = details.page?.items ?? []
  // Доля — от самого нагруженного списка окна: так полоски сравнимы между собой,
  // а не с абстрактной сотней.
  const top = items.reduce((max, it) => Math.max(max, it.count), 0)

  return (
    <Body details={details} lang={lang}>
      <ul className="mt-2 flex flex-col gap-2">
        {items.map((it) => (
          <li key={it.id}>
            <ListRow item={it} share={top > 0 ? it.count / top : 0} handle={handle} kind={kind} windowKey={windowKey} lang={lang} />
          </li>
        ))}
      </ul>
    </Body>
  )
}

/**
 * Строка списка: стрелка раскрытия, название-ссылка, счётчик и полоска доли.
 *
 * Раскрывает именно стрелка, а не строка целиком: внутри строки живёт ссылка на
 * список, а ссылка внутри кнопки — невалидная разметка и ловушка для клавиатуры.
 */
function ListRow({
  item,
  share,
  handle,
  kind,
  windowKey,
  lang,
}: {
  item: TopicList
  share: number
  handle: string
  kind: ActivityKind
  windowKey: string
  lang: Lang
}) {
  const [open, setOpen] = useState(false)
  const title = tr(item.title, lang) || item.slug
  // У созданных списков третьего уровня нет: сам список и есть событие.
  const deep = kind !== 'lists'

  return (
    <>
      <div className="flex items-center gap-1.5">
        {deep ? (
          <IconButton
            size="xs"
            label={fill('profile.activity.expandList', lang, { title })}
            aria-expanded={open}
            variant="ghost"
            onClick={() => setOpen((was) => !was)}
          >
            <ChevronRight size={13} className={`transition-transform duration-(--dur-base) ${open ? 'rotate-90' : ''}`} />
          </IconButton>
        ) : (
          <span className="w-6 shrink-0" aria-hidden />
        )}
        {/* Полоска стоит рядом со счётчиком короткой колонкой, как у GitHub: во всю
            ширину строки она читается как прогресс-бар загрузки, а не как доля. */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* Ссылка ведёт к ВЛАДЕЛЬЦУ списка: задачу и правку человек мог оставить
              в чужом, и адрес по нику профиля упирался бы в 404 или чужой список
              с тем же slug (slug уникален только внутри владельца). */}
          <Link href={`/${item.ownerHandle}/${item.slug}`} className="min-w-0 flex-1 truncate text-body text-accent hover:underline">
            {title}
          </Link>
          {/* Счётчики держат колонку: без фиксированной ширины они гуляют и полоски
              перестают читаться как один ряд. */}
          <span className="shrink-0 text-right font-mono text-caption tabular-nums text-muted">
            {deep ? fmtNumber(item.count, lang) : dayMonthYear(item.at, lang)}
          </span>
          {deep && <Meter value={share} tone="ok" className="w-10 shrink-0 sm:w-16" />}
        </div>
      </div>

      {deep && open && <ListEvents handle={handle} kind={kind} windowKey={windowKey} listId={item.id} lang={lang} />}
    </>
  )
}

/** Третий уровень: сами события списка — версия, задача или предложение с датой. */
function ListEvents({
  handle,
  kind,
  windowKey,
  listId,
  lang,
}: {
  handle: string
  kind: ActivityKind
  windowKey: string
  listId: string
  lang: Lang
}) {
  const details = useDetails<ListEvent>(handle, { kind, windowKey, listId })
  return (
    <Body details={details} lang={lang} className="ml-7">
      <ul className="mt-1 flex flex-col gap-1 border-l border-border pl-3">
        {(details.page?.items ?? []).map((e) => (
          <li key={`${e.ref}:${e.at}`} className="flex items-baseline justify-between gap-3 text-body-sm">
            <span className="min-w-0 truncate text-ink-2">
              <span className="font-mono text-muted">{kind === 'versions' ? `v${e.ref}` : `#${e.ref}`}</span>
              {e.text ? ` ${e.text}` : ''}
            </span>
            <span className="shrink-0 text-caption text-muted">{dayMonthYear(e.at, lang)}</span>
          </li>
        ))}
      </ul>
    </Body>
  )
}

/** Обвязка раскрытия: заглушка, сбой с «Повторить», хвост «показаны первые». */
function Body<T extends TopicList | ListEvent>({
  details,
  lang,
  children,
  className = '',
}: {
  details: Details<T>
  lang: Lang
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`sf-rise-in sf-slow ${className}`}>
      {details.failed ? (
        <div className="flex flex-wrap items-center gap-3 py-1">
          <p className="text-body-sm text-danger">{t('profile.activity.loadFailed', lang)}</p>
          <Button size="xs" onClick={details.retry}>
            {t('tryAgain', lang)}
          </Button>
        </div>
      ) : !details.page ? (
        <div className="flex flex-col gap-1.5 py-1">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ) : details.page.items.length === 0 ? (
        <p className="py-1 text-body-sm text-muted">{t('profile.activity.emptyDetails', lang)}</p>
      ) : (
        <>
          {children}
          <Tail page={details.page} lang={lang} />
        </>
      )}
    </div>
  )
}

/** Перечень обрезан лимитом — говорим об этом, а не молчим. */
function Tail<T>({ page, lang }: { page: DetailsPage<T>; lang: Lang }) {
  if (page.total <= page.items.length) return null
  return (
    <p className="mt-1.5 text-caption text-muted">
      {fill('profile.activity.showingFirst', lang, { n: fmtNumber(page.items.length, lang), total: fmtNumber(page.total, lang) })}
    </p>
  )
}
