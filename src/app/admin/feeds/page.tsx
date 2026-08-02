import { ExternalLink } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
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

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('adminFeeds', lang) }
}

export default async function AdminFeedsPage({ searchParams }: { searchParams: Promise<{ err?: string; fresh?: string }> }) {
  await requireAdmin()
  // Независимые запросы — параллельно (react-doctor).
  const [lang, sp, [rows, items]] = await Promise.all([getLang(), searchParams, Promise.all([feedSourceRows(), recentFeedItems()])])

  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      <PageHeader
        title={t('admin.feeds', lang)}
        subtitle={t('admin.sourcesCompanyDrawsEvents', lang)}
      />

      {sp.fresh && (
        <Alert variant="ok">
          {t('admin.newItems', lang)} {sp.fresh}
        </Alert>
      )}

      <FeedSourceList rows={rows} lang={lang} err={sp.err} />

      {/* ЧТО ПРИШЛО. Доказательство, что поток живой; заодно видно, что уже пошло в работу. */}
      <div className="min-w-0">
        <div className="mb-2 text-[0.8125rem] font-semibold uppercase tracking-wide text-ink-2">{t('admin.latestMaterial', lang)}</div>
        <div className="divide-y divide-border rounded-lg border border-border bg-surface">
          {items.length === 0 && <EmptyState variant="inline" hint={t('admin.nothingCollectedYet', lang)} />}
          {items.map((it) => (
            <div key={it.id} className="flex min-w-0 items-center gap-3 px-4 py-2.5">
              <a
                href={it.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate text-[0.8125rem] text-ink hover:text-accent"
                title={it.title}
              >
                <span className="min-w-0 truncate">{it.title}</span>
                <ExternalLink size={11} className="shrink-0 text-muted" />
              </a>
              <span className="hidden shrink-0 font-mono text-[0.6875rem] text-muted sm:inline">{timeAgo(it.publishedAt ?? it.createdAt, lang)}</span>
              <span className={`shrink-0 text-[0.6875rem] ${it.usedAt ? 'text-ok' : 'text-muted'}`}>
                {it.usedAt ? t('admin.inWork', lang) : t('admin.fresh', lang)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
