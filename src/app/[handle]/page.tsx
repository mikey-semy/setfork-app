// БЕЗ loading.tsx намеренно. Скелетон на этом сегменте включает потоковую отдачу:
// шапка ответа уходит клиенту сразу, и notFound() из загрузчика уже не может поставить
// 404 — прод отдавал страницу «не найдено» с кодом 200, а поисковик считал её живой.
// Замер после снятия скелетона: первый байт 0,3 с — ждать нечего.
import { BookOpen, FolderGit2, ListChecks, Star, Users } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { EmptyState } from '@/shared/ui/EmptyState'
import { TabItem, TabNav } from '@/shared/ui/TabNav'
import { PeopleResults } from '@/features/profile/PeopleResults'
import { getUserByHandle } from '@/features/profile/queries'
import { PAGE } from '@/shared/ui/control'
import { loadProfilePage, type ProfileSearchParams } from './load'
import { ProfileAside } from './ProfileAside'
import { ProfileLists } from './ProfileLists'
import { ProfileOverview } from './ProfileOverview'
import { ProfileCatalogCard } from '@/features/catalogs/ProfileCatalogCard'

// Заголовок вкладки: «Имя (handle)» как в GitHub (layout добавит « · SetFork»).
export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const user = await getUserByHandle(handle)
  if (!user) return { title: handle }
  // Приватный профиль не раскрываем в мете (og:title/desc) чужим — только сам ник.
  if (user.profilePrivate) {
    const viewer = await getSession()
    if (viewer?.userId !== user.id) return { title: handle }
  }
  return {
    title: user.name ? `${user.name} (${handle})` : handle,
    description: user.bio ?? undefined,
  }
}

/**
 * Страница профиля. Здесь только состав: какие вкладки есть и что стоит в колонках.
 * Правила («кому сюда можно», «что попадает в выдачу», «какая страница») живут в
 * [load.ts](./load.ts), вид каждой вкладки — в соседних `Profile*.tsx`.
 */
export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>
  searchParams: Promise<ProfileSearchParams>
}) {
  const [{ handle }, sp, lang] = await Promise.all([params, searchParams, getLang()])
  const loaded = await loadProfilePage({ handle, sp, lang })
  const { tab, isPeopleTab, isOwner, counts, followCounts, catalogs, people, quotaHit } = loaded

  return (
    <div className="w-full">
      {/* Табы профиля — full-width под шапкой; единый TabNav из shared/ui. */}
      <TabNav scope="profile" overflow={{ moreLabel: t('moreTabs', lang) }}>
        {isPeopleTab ? (
          <>
            <TabItem href={`/${handle}?tab=followers`} on={tab === 'followers'} icon={<Users size={15} />} label={t('followersLabel', lang)} count={followCounts.followers} />
            <TabItem href={`/${handle}?tab=following`} on={tab === 'following'} icon={<Users size={15} />} label={t('followingLabel', lang)} count={followCounts.following} />
          </>
        ) : (
          <>
            <TabItem href={`/${handle}`} on={tab === 'overview'} icon={<BookOpen size={15} />} label={t('overviewTab', lang)} />
            <TabItem href={`/${handle}?tab=lists`} on={tab === 'lists'} icon={<ListChecks size={15} />} label={t('lists', lang)} count={counts.lists} />
            <TabItem href={`/${handle}?tab=starred`} on={tab === 'starred'} icon={<Star size={15} />} label={t('starredTab', lang)} count={counts.stars} />
            {catalogs.length > 0 && (
              <TabItem href={`/${handle}?tab=catalogs`} on={tab === 'catalogs'} icon={<FolderGit2 size={15} />} label={t('catalogsTab', lang)} count={catalogs.length} />
            )}
          </>
        )}
      </TabNav>

      {/* Вернулись сюда, упершись в потолок списков: объясняем, а не молчим. */}
      {quotaHit && isOwner && (
        <div className={`${PAGE} mt-4`}>
          <div className="rounded-md border border-warn/50 bg-surface px-3 py-2.5 text-body text-warn">{t('profile.listQuotaHit', lang)}</div>
        </div>
      )}

      <div className={PAGE}>
        <div className="flex flex-col gap-8 md:flex-row">
          <ProfileAside {...loaded} />

          <section className="min-w-0 flex-1">
            {tab === 'overview' ? (
              <ProfileOverview {...loaded} />
            ) : isPeopleTab ? (
              people.length === 0 ? (
                <EmptyState hint={tab === 'followers' ? t('noFollowers', lang) : t('noFollowing', lang)} />
              ) : (
                <PeopleResults people={people} lang={lang} />
              )
            ) : tab === 'catalogs' ? (
              catalogs.length === 0 ? (
                <EmptyState hint={t('noCatalogsYet', lang)} />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {catalogs.map((c) => (
                    <ProfileCatalogCard
                      key={c.id}
                      catalog={c}
                      handle={handle}
                      lang={lang}
                    />
                  ))}
                </div>
              )
            ) : (
              <ProfileLists {...loaded} />
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
