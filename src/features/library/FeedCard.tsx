import Link from 'next/link'
import { ListChecks, Star } from 'lucide-react'
import { TagChip } from '@/shared/ui/TagChip'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, tr, type Lang } from '@/shared/i18n'
import { toggleStar } from '@/features/library/actions'
import type { FeedItem } from './queries'
import { buttonClass } from '@/shared/ui/button-style'
import { ListCardMeta } from './ListCardMeta'

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'k'
  return String(n)
}

/** Карточка списка в витрине Explore — по анатомии карточки репозитория GitHub
 *  Explore (сверху вниз): обложка (если есть) → owner/title + ⭐ Star (как у нас) →
 *  бейджи → описание → строка-инфо со счётчиками (аналог вкладок GitHub) → футер
 *  с датой обновления. Без фейкового баннера и без значка языка. */
export function FeedCard({ item, lang, starred = false }: { item: FeedItem; lang: Lang; starred?: boolean }) {
  const star = toggleStar.bind(null, item.id)
  const base = `/${item.ownerHandle}/${item.slug}`
  const desc = tr(item.desc, lang)
  const updated = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(item.updatedAt))

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface transition-colors hover:border-border-strong">
      {/* 1. Обложка — только если реально загружена (иначе идентичность даёт заголовок). */}
      {item.coverImage && (
        // eslint-disable-next-line @next/next/no-img-element -- внешний ассет по готовому URL
        <img src={item.coverImage} alt="" className="h-24 w-full border-b border-border object-cover sm:h-28" />
      )}

      {/* Шапка отделена так же, как футер. Owner / title — один обрезаемый ряд:
          отдельные flex-элементы раньше переносили весь перевод заголовка вниз. */}
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Link href={base} className="-m-1 grid size-6 shrink-0 place-items-center text-muted hover:text-accent" aria-label={tr(item.title, lang)}>
            <ListChecks size={16} />
          </Link>
          <div className="min-w-0 flex-1 truncate whitespace-nowrap text-title leading-5">
            <Link href={`/${item.ownerHandle}`} className="font-medium text-ink-2 hover:text-accent">
              {item.ownerHandle}
            </Link>
            <span className="text-muted"> / </span>
            <Link href={base} title={tr(item.title, lang)} className="font-bold text-accent hover:underline">
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

      <div className="px-4 py-3">
        {/* Описание. */}
        {desc && <p className="line-clamp-2 text-body leading-snug text-ink-2">{desc}</p>}

        {/* Теги. */}
        {item.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.tags.slice(0, 5).map((tag) => (
              <TagChip key={tag} slug={tag} />
            ))}
          </div>
        )}

        <ListCardMeta item={item} lang={lang} className={desc || item.tags.length > 0 ? 'mt-3' : undefined} />
      </div>

      {/* Футер — самостоятельная полоса, симметричная шапке. */}
      <div className="border-t border-border px-4 py-2 text-caption text-muted">
        {t('updated', lang)} {updated}
      </div>
    </div>
  )
}
