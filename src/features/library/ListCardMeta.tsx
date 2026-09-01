import Link from 'next/link'
import { GitFork, PlayCircle, Tag } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { t, type Lang } from '@/shared/i18n'
import { LIST_VISIBILITY_BADGE, listVisibilityState } from '@/shared/list-visibility'
import { VerificationBadge } from './VerificationBadge'
import type { FeedItem } from './queries'

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'k'
  return String(n)
}

/**
 * Единая строка метаданных карточки списка. Explore, Trending и обе профильные
 * вкладки рендерят одну FeedCard, поэтому версия и состояние больше не могут
 * расходиться между Lists и Starred из-за локальной разметки.
 */
export function ListCardMeta({ item, lang, className }: { item: FeedItem; lang: Lang; className?: string }) {
  const base = `/${item.ownerHandle}/${item.slug}`
  const visibility = LIST_VISIBILITY_BADGE[listVisibilityState(item)]
  const VisibilityIcon = visibility.Icon

  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-ink-2', className)}>
      <Link href={`${base}/releases`} className="inline-flex items-center gap-1.5 hover:text-accent">
        <Tag size={14} className="text-muted" />
        <span>
          v<b className="text-ink">{item.version}</b>
        </span>
      </Link>
      <span className="inline-flex items-center gap-1.5">
        <VisibilityIcon size={14} className="text-muted" />
        {t(visibility.labelKey, lang)}
      </span>
      {/* Значка «проверен» здесь НЕТ и быть не должно: решение 0006 от 07.07.2026
          («видимость = верификация») говорит прямо — публичного бейджа нет, потому что
          видимый публичный список и есть прошедший проверку, а отдельный значок обещал
          бы вторую, которой не существует. Флаг `verified` остаётся ВНУТРЕННИМ
          инструментом модерации (админская таблица), и там значок на месте. */}
      {/* А ВОТ УРОВЕНЬ ПРОВЕРКИ ВЕРСИИ (0018) — другая вещь и остаётся. Он говорит не
          «сайт ручается», а «эту версию кто-то прогнал/сверил, вот когда»: у него есть
          предмет и дата. Именно отсутствие предмета делало прежний значок обещанием без
          содержания. Порода не рисуется — отсутствие метки и есть «никто не проверял». */}
      <VerificationBadge level={item.verificationLevel} verifiedAt={item.verifiedAt} lang={lang} />
      <Link href={`${base}/forks`} className="inline-flex items-center gap-1.5 hover:text-accent">
        <GitFork size={14} className="text-muted" /> {fmt(item.forksCount)}
      </Link>
      <span className="inline-flex items-center gap-1.5">
        <PlayCircle size={14} className="text-muted" /> {fmt(item.runsCount)}
      </span>
    </div>
  )
}
