import Link from 'next/link'
import { BadgeCheck, GitFork, ListChecks, Lock, Play, Star } from 'lucide-react'
import { TagChip } from '@/shared/ui/TagChip'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, tr, type Lang } from '@/shared/i18n'
import { toggleStar } from '@/features/library/actions'
import type { FeedItem } from './queries'
import { buttonClass } from '@/shared/ui/button-style'

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

      <div className="p-4">
        {/* 2. Заголовок owner/title + 3. Кнопка Star (как у нас), в правом верхнем углу. */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <Link href={base} className="-m-1 mt-0.5 grid size-6 shrink-0 place-items-center text-muted hover:text-accent" aria-label={tr(item.title, lang)}>
              <ListChecks size={16} />
            </Link>
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[1rem] leading-tight">
              <Link href={`/${item.ownerHandle}`} className="-my-1 py-1 font-medium text-ink-2 hover:text-accent">
                {item.ownerHandle}
              </Link>
              <span className="text-muted">/</span>
              <Link href={base} className="min-w-0 break-words font-bold text-accent hover:underline">
                {tr(item.title, lang)}
              </Link>
              {item.verified && (
                <Tooltip label={t('verifiedBadge', lang)}>
                  <BadgeCheck size={14} className="shrink-0 text-accent" />
                </Tooltip>
              )}
              {/* Версия уехала ВНИЗ, к счётчикам: в строке заголовка она на мобиле
                  переносилась на свою строку и рвала карточку пустотой посередине —
                  ровно то, чего строка заголовка должна была избежать. Статусы
                  (черновик/приватный) остаются здесь: это не счётчик, а состояние. */}
              {item.status === 'draft' && (
                <span className="rounded-md border border-warn px-1.5 py-0.5 text-[0.6875rem] font-medium text-warn">{t('draftBadge', lang)}</span>
              )}
              {item.visibility === 'private' && (
                <Tooltip label="private">
                  <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[0.6875rem] text-ink-2">
                    <Lock size={10} />
                  </span>
                </Tooltip>
              )}
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

        {/* Описание. */}
        {desc && <p className="mt-2 line-clamp-2 text-[0.8125rem] leading-snug text-ink-2">{desc}</p>}

        {/* Теги. */}
        {item.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.tags.slice(0, 5).map((tag) => (
              <TagChip key={tag} slug={tag} />
            ))}
          </div>
        )}

        {/* 4. Строка-инфо со счётчиками (аналог вкладок GitHub «со всей информацией»). */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.78125rem] text-muted">
          {/* Версия первой: она отвечает на «что это за список», а не «как его оценили». */}
          <span className="font-mono text-[0.6875rem]">v{item.version}</span>
          {/* Звёзд здесь БОЛЬШЕ НЕТ: их счётчик уже стоит в кнопке справа вверху, и одно и то
              же число дважды на одной карточке — это не акцент, а шум. */}
          <span className="inline-flex items-center gap-1">
            <GitFork size={12} /> {fmt(item.forksCount)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Play size={11} /> {fmt(item.runsCount)}
          </span>
        </div>

        {/* 5. Футер — дата последнего обновления. */}
        <div className="mt-3 border-t border-border pt-2 text-[0.6875rem] text-muted">
          {t('updated', lang)} {updated}
        </div>
      </div>
    </div>
  )
}
