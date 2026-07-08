import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { getActivity, getUserTemplates } from '@/features/library/queries'
import { getImprovementFeed } from '@/features/improve/queries'
import { getFollowingIds } from '@/features/follows/queries'
import { getWatchedIds } from '@/features/watch/queries'
import { getFeedEvents, getRecommended, getStarredIds, type FeedEvent } from '@/features/feed/queries'
import { Feed } from '@/features/feed/Feed'
import { CreateWithAI } from '@/features/feed/CreateWithAI'
import type { Lang } from '@/shared/i18n'
import { ListsPanel } from './ListsPanel'
import { t, tr } from '@/shared/i18n'
import { PromoCard } from './PromoCard'
import { ChangelogCard } from './ChangelogCard'

// Dashboard залогиненного (GitHub-стиль, full-width):
//   слева — Your lists (переиспользуемая панель с фильтром),
//   центр — AI-area + Feed из подписок (клиентский фильтр событий) + Recommended,
//   справа — промо-слот + публичный changelog.

export async function Dashboard({ lang, userId }: { lang: Lang; userId: string }) {
  const [mine, following, watched, starred] = await Promise.all([
    getUserTemplates(userId, userId),
    getFollowingIds(userId),
    getWatchedIds(userId),
    getStarredIds(userId),
  ])
  const hasScope = following.length > 0 || watched.length > 0 || starred.length > 0
  let events: FeedEvent[] = hasScope
    ? await getFeedEvents({ followingIds: following, watchedIds: watched, starredIds: starred }, 40)
    : []
  // Пустые подписки → общая лента версий (с подсказкой «подпишись»), как раньше.
  const emptyHint = events.length === 0
  if (emptyHint) {
    const global = await getActivity(30, userId)
    events = global.map((a) => ({
      type: a.version === 1 ? (a.origin === 'forked' ? ('forked' as const) : ('created' as const)) : ('version' as const),
      actorHandle: a.ownerHandle,
      actorAvatarUrl: a.ownerAvatarUrl,
      ownerHandle: a.ownerHandle,
      slug: a.slug,
      title: a.title,
      version: a.version,
      note: a.note,
      createdAt: a.createdAt,
    }))
  }
  const [recommended, improve] = await Promise.all([getRecommended(userId, starred, 4), getImprovementFeed(userId, 3)])

  return (
    <div className="grid w-full gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[300px_minmax(0,1fr)_300px] lg:px-8">
      {/* Слева: твои списки (переиспользуемая панель) */}
      <aside className="lg:sticky lg:top-[68px] lg:self-start">
        <ListsPanel
          lang={lang}
          title={t('yourLists', lang)}
          items={mine.map((m) => ({ handle: m.ownerHandle, slug: m.slug, avatarUrl: m.ownerAvatarUrl, version: m.version }))}
          showNew
          showVersion
          emptyText={t('emptyMyLists', lang)}
        />
      </aside>

      {/* Центр: AI-area + лента */}
      <div className="min-w-0">
        <CreateWithAI lang={lang} />
        {improve.length > 0 && (
          <div className="mb-4 rounded-lg border border-border bg-surface p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-2">
                <Sparkles size={14} className="text-accent" /> {lang === 'ru' ? 'Что улучшить' : 'What to improve'}
              </span>
              <Link href="/improve" className="text-[12px] text-accent hover:underline">{lang === 'ru' ? 'все' : 'all'}</Link>
            </div>
            <ul className="flex flex-col gap-1.5">
              {improve.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-2 text-[13px]">
                  <Link href={`/${it.ownerHandle}/${it.slug}`} className="min-w-0 truncate text-accent hover:underline">{tr(it.title, lang)}</Link>
                  <span className="shrink-0 font-mono text-[11px] text-muted">
                    {it.openSuggestions > 0 && <span className="text-accent">⑂{it.openSuggestions} </span>}
                    {it.openIssues > 0 && <span className="text-warn">◍{it.openIssues}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Feed events={events} recommended={recommended} lang={lang} emptyHint={emptyHint} />
      </div>

      {/* Справа: промо-слот + changelog */}
      <aside className="hidden lg:sticky lg:top-[68px] lg:flex lg:flex-col lg:gap-4 lg:self-start">
        <PromoCard lang={lang} />
        <ChangelogCard lang={lang} />
      </aside>
    </div>
  )
}
