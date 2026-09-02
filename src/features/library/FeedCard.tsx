import Link from 'next/link'
import { ListChecks, Star } from 'lucide-react'
import { TagChip } from '@/shared/ui/TagChip'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, tr, type Lang } from '@/shared/i18n'
import { toggleStar } from '@/features/library/actions'
import type { FeedItem } from './queries'
import { buttonClass } from '@/shared/ui/button-style'
import { SmartImage } from '@/shared/ui/SmartImage'
import { ListCardMeta } from './ListCardMeta'
import { ListStateBadge } from './ListStateBadge'
import type { ListDensity } from '@/shared/lib/list-density'

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'k'
  return String(n)
}

/** Карточка списка в витрине Explore — по анатомии карточки репозитория GitHub
 *  Explore (сверху вниз): обложка (если есть) → owner/title + ⭐ Star (как у нас) →
 *  бейджи → описание → строка-инфо со счётчиками (аналог вкладок GitHub) → футер
 *  с датой обновления. Без фейкового баннера и без значка языка. */
export function FeedCard({
  item,
  lang,
  starred = false,
  density = 'comfy',
}: {
  item: FeedItem
  lang: Lang
  starred?: boolean
  /** «Плотно» — только имя, состояние и счётчики: описание, теги и подвал скрыты. */
  density?: ListDensity
}) {
  const star = toggleStar.bind(null, item.id)
  const base = `/${item.ownerHandle}/${item.slug}`
  const desc = tr(item.desc, lang)
  const compact = density === 'compact'
  const updated = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(item.updatedAt))

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface transition-colors hover:border-border-strong">
      {/* 1. Обложка — только если реально загружена (иначе идентичность даёт заголовок). */}
      {!compact && item.coverImage && (
        // eslint-disable-next-line @next/next/no-img-element -- внешний ассет по готовому URL
        <SmartImage src={item.coverImage} alt="" className="h-24 w-full border-b border-border object-cover sm:h-28" />
      )}

      {/* Шапка отделена так же, как футер. ДВЕ СТРОКИ, а не одна: у нас заголовки
          длиннее имён репозиториев, и ряд «владелец / заголовок» на телефоне обрезался
          ровно на заголовке — то есть на самом важном (решение владельца 01.09.2026).
          Теперь владелец и состояние идут первой строкой, заголовок — своей и целиком. */}
      <div className="flex min-w-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Link href={base} className="-m-1 mt-0.5 grid size-6 shrink-0 place-items-center text-muted hover:text-accent" aria-label={tr(item.title, lang)}>
            <ListChecks size={16} />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <Link href={`/${item.ownerHandle}`} className="min-w-0 truncate font-medium text-ink-2 hover:text-accent">
                {item.ownerHandle}
              </Link>
              {/* Состояние — у ИМЕНИ, как бейдж Private у GitHub: при беглом просмотре
                  видно там же, где имя, а не среди чисел ниже. */}
              <ListStateBadge item={item} lang={lang} />
            </div>
            <Link
              href={base}
              title={tr(item.title, lang)}
              className="mt-0.5 line-clamp-2 block font-bold text-accent hover:underline [overflow-wrap:anywhere]"
            >
              {tr(item.title, lang)}
            </Link>
          </div>
        </div>
        <form action={star} className="shrink-0">
          <Tooltip label={t('star', lang)}>
            <button
              type="submit"
              className={buttonClass({
                size: 'sm',
                className: starred ? 'border-warn text-warn hover:border-warn' : 'text-ink-2',
              })}
            >
              <Star size={14} fill={starred ? 'currentColor' : 'none'} /> {fmt(item.starsCount)}
            </button>
          </Tooltip>
        </form>
      </div>

      <div className={compact ? 'px-4 py-2' : 'px-4 py-3'}>
        {/* Описание. В плотном виде его нет — как и обложки выше: они и есть весь
            расход высоты, обложка даже больший (96px против ~40px описания). */}
        {compact ? null : desc && <p className="line-clamp-2 text-body leading-snug text-ink-2">{desc}</p>}

        {/* Теги. */}
        {!compact && item.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.tags.slice(0, 5).map((tag) => (
              <TagChip key={tag} slug={tag} />
            ))}
          </div>
        )}

        <ListCardMeta item={item} lang={lang} className={!compact && (desc || item.tags.length > 0) ? 'mt-3' : undefined} />
      </div>

      {/* Футер — самостоятельная полоса, симметричная шапке. В плотном виде дата
          уходит: она реже всего нужна при просмотре десятка списков подряд. */}
      {!compact && (
        <div className="border-t border-border px-4 py-2 text-caption text-muted">
          {t('updated', lang)} {updated}
        </div>
      )}
    </div>
  )
}
