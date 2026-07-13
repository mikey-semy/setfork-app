import Link from 'next/link'
import { GitFork, Lock, Star } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { cardAccent } from '@/shared/ui/AutoBanner'
import { t, tr, type Lang } from '@/shared/i18n'
import { toggleStar } from '@/features/library/actions'
import type { FeedItem } from './queries'

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'k'
  return String(n)
}

/** Карточка-строка (как список репозиториев GitHub): слева accent-полоса (цвет
 *  списка — идентичность без фейкового баннера), имя = title, клик открывает;
 *  единственное действие на карточке — ⭐ Star (сигнал качества + коллекция). */
export function FeedCard({ item, lang, starred = false }: { item: FeedItem; lang: Lang; starred?: boolean }) {
  const star = toggleStar.bind(null, item.id)
  const a = cardAccent(item.accent, item.id)
  // Язык контента ≠ языку интерфейса → бейдж кода языка (ADR-0009: единый пул,
  // иностранные списки в ленте — норма, а не ошибка). Есть перевод — бейдж не нужен.
  const foreignLang = item.title[lang] ? null : Object.keys(item.title).find((k) => item.title[k])
  return (
    <div className="relative flex items-start gap-3 overflow-hidden rounded-lg border border-border bg-surface py-3 pr-3.5 pl-4 transition-colors hover:border-border-strong">
      {/* accent-полоса слева — идентичность списка (без синтетического баннера в ленте) */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: `linear-gradient(180deg, ${a}, color-mix(in srgb, ${a} 55%, transparent))` }}
      />
      <Link href={`/${item.ownerHandle}`} className="shrink-0">
        <Avatar handle={item.ownerHandle} avatarUrl={item.ownerAvatarUrl} size={32} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14.5px]">
            <Link href={`/${item.ownerHandle}`} className="font-semibold text-ink-2 hover:text-accent">
              {item.ownerHandle}
            </Link>
            <span className="text-muted"> / </span>
            <Link href={`/${item.ownerHandle}/${item.slug}`} className="font-bold text-ink hover:text-accent hover:underline">
              {tr(item.title, lang)}
            </Link>
          </span>
          <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2">
            v{item.version}
          </span>
          {foreignLang && (
            <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted" title={foreignLang}>
              {foreignLang}
            </span>
          )}
          {item.status === 'draft' && (
            <span className="rounded border border-warn px-1.5 py-0.5 text-[10.5px] font-medium text-warn">
              {t('draftBadge', lang)}
            </span>
          )}
          {item.visibility === 'private' && (
            <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10.5px] text-ink-2" title="private">
              <Lock size={10} />
            </span>
          )}
          {item.tags.slice(0, 4).map((tag) => (
            <Link
              key={tag}
              href={`/search?q=${encodeURIComponent(`tag:${tag}`)}`}
              className="rounded-full bg-(--accent-soft) px-2 py-0.5 text-[11px] font-medium text-accent hover:underline"
            >
              {tag}
            </Link>
          ))}
        </div>
        <div className="mt-1 truncate text-[12.5px] text-ink-2">{tr(item.desc, lang)}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-3.5 text-[11.5px] text-muted">
          <span className="inline-flex items-center gap-1">
            <GitFork size={12} /> {fmt(item.forksCount)}
          </span>
          <span>
            {new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', { month: 'short', day: 'numeric' }).format(
              new Date(item.updatedAt),
            )}
          </span>
        </div>
      </div>

      {/* Обложка — компактный thumb, ТОЛЬКО если реально загружена (иначе идентичность даёт полоса слева). */}
      {item.coverImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.coverImage} alt="" className="hidden h-14 w-24 shrink-0 self-center rounded-md border border-border object-cover sm:block" />
      )}

      {/* единственное действие — Star */}
      <form action={star} className="shrink-0">
        <button
          title="star"
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors hover:border-border-strong ${
            starred ? 'border-warn text-warn' : 'border-border text-ink-2'
          }`}
        >
          <Star size={14} fill={starred ? 'currentColor' : 'none'} /> {fmt(item.starsCount)}
        </button>
      </form>
    </div>
  )
}
