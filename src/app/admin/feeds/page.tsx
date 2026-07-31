import { ExternalLink } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { tr } from '@/shared/i18n'
import { timeAgo } from '@/shared/ui/timeAgo'
import { Alert } from '@/shared/ui/Alert'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { FeedSourceList } from '@/features/admin/FeedSourceList'
import { feedSourceRows, recentFeedItems } from '@/features/admin/feed-queries'

/**
 * ПОДПИСКИ НА ПОТОК (админу): откуда компания узнаёт, что произошло.
 *
 * Здесь же лежит ответ на вопрос «а оно работает?»: последние пришедшие материалы. Без этой
 * витрины подписка выглядела бы «настроенной» независимо от того, приносит она что-нибудь
 * или молча падает.
 *
 * Тела статей не показываем и не храним: заголовок, адрес, дата. Новости не под свободной
 * лицензией — воспроизводить их текст нельзя, и это ограничение записано в схеме, а не в
 * договорённости.
 */
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Feeds' }

export default async function AdminFeedsPage({ searchParams }: { searchParams: Promise<{ err?: string; fresh?: string }> }) {
  await requireAdmin()
  const lang = await getLang()
  const sp = await searchParams
  const say = (en: string, ru: string) => tr({ en, ru }, lang)
  const [rows, items] = await Promise.all([feedSourceRows(), recentFeedItems()])

  return (
    <div className="flex w-full min-w-0 flex-col gap-5 px-5 py-6 md:px-8">
      <PageHeader
        title={say('Feeds', 'Потоки')}
        subtitle={say(
          'Sources the company draws events from. A specialist turns an event into a practical list — he never retells it.',
          'Источники, из которых компания узнаёт о событиях. Специалист превращает событие в практический список, а не пересказывает его.',
        )}
      />

      {sp.fresh && (
        <Alert variant="ok">
          {say('New items:', 'Новых материалов:')} {sp.fresh}
        </Alert>
      )}

      <FeedSourceList rows={rows} lang={lang} err={sp.err} />

      {/* ЧТО ПРИШЛО. Доказательство, что поток живой; заодно видно, что уже пошло в работу. */}
      <div className="min-w-0">
        <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-2">{say('Latest material', 'Последние материалы')}</div>
        <div className="divide-y divide-border rounded-lg border border-border bg-surface">
          {items.length === 0 && <EmptyState variant="inline" hint={say('Nothing collected yet.', 'Пока ничего не собрано.')} />}
          {items.map((it) => (
            <div key={it.id} className="flex min-w-0 items-center gap-3 px-4 py-2.5">
              <a
                href={it.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate text-[13px] text-ink hover:text-accent"
                title={it.title}
              >
                <span className="min-w-0 truncate">{it.title}</span>
                <ExternalLink size={11} className="shrink-0 text-muted" />
              </a>
              <span className="hidden shrink-0 font-mono text-[11px] text-muted sm:inline">{timeAgo(it.publishedAt ?? it.createdAt, lang)}</span>
              <span className={`shrink-0 text-[11px] ${it.usedAt ? 'text-ok' : 'text-muted'}`}>
                {it.usedAt ? say('in work', 'в работе') : say('fresh', 'свежий')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
