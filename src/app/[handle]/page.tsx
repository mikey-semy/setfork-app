import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FolderGit2, Link2, MapPin, Pin } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { FeedList } from '@/features/library/FeedList'
import { getPinnedTemplates, getUserTemplates } from '@/features/library/queries'
import { getContributions, getProfileCounts, getReceivedStats, getStarredTemplates, getUserByHandle } from '@/features/profile/queries'
import { getFollowers, getFollowing } from '@/features/profile/search'
import { PeopleResults } from '@/features/profile/PeopleResults'
import { getOwnerCatalogs } from '@/features/catalogs/queries'
import { ActivityGraph } from '@/features/profile/ActivityGraph'
import { getFollowCounts, isFollowing } from '@/features/follows/queries'
import { FollowButton } from '@/features/follows/FollowButton'
import { avatarSrc } from '@/shared/media'
import { SocialIcon, socialLabel } from '@/features/settings/socials'

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

type Tab = 'overview' | 'lists' | 'starred' | 'catalogs' | 'followers' | 'following'

// Заголовок вкладки: «Имя (handle)» как в GitHub (layout добавит « · SetFork»).
export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const user = await getUserByHandle(handle)
  if (!user) return { title: handle }
  return {
    title: user.name ? `${user.name} (${handle})` : handle,
    description: user.bio ?? undefined,
  }
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const [{ handle }, sp, lang, viewer] = await Promise.all([params, searchParams, getLang(), getSession()])
  const user = await getUserByHandle(handle)
  if (!user) notFound()

  const tab: Tab =
    sp.tab === 'lists' ? 'lists'
    : sp.tab === 'starred' ? 'starred'
    : sp.tab === 'catalogs' ? 'catalogs'
    : sp.tab === 'followers' ? 'followers'
    : sp.tab === 'following' ? 'following'
    : 'overview'
  const isPeopleTab = tab === 'followers' || tab === 'following'
  const isListsTab = tab === 'lists' || tab === 'starred'
  const isOwner = viewer?.userId === user.id
  const [counts, followCounts, following, bigAvatar, contributions, received] = await Promise.all([
    getProfileCounts(user.id),
    getFollowCounts(user.id),
    viewer && !isOwner ? isFollowing(viewer.userId, user.id) : Promise.resolve(false),
    avatarSrc(user.avatarUrl, 180),
    getContributions(user.id),
    getReceivedStats(user.id),
  ])
  const [items, pinned, catalogs] = await Promise.all([
    !isListsTab ? Promise.resolve([]) : tab === 'starred' ? getStarredTemplates(user.id, viewer?.userId) : getUserTemplates(user.id, viewer?.userId),
    getPinnedTemplates(user.id, viewer?.userId),
    getOwnerCatalogs(user.id),
  ])
  const people = tab === 'followers' ? await getFollowers(user.id) : tab === 'following' ? await getFollowing(user.id) : []

  return (
    <div className="w-full px-6 py-8 lg:px-8">
      <div className="mx-auto flex max-w-[980px] flex-col gap-8 md:flex-row">
        <aside className="flex-shrink-0 md:w-[280px]">
          <Avatar handle={user.handle} avatarUrl={bigAvatar} size={180} rounded="rounded-2xl" />
          <div className="mt-4">
            {user.name && <div className="text-[22px] font-bold leading-tight text-ink">{user.name}</div>}
            <div className="text-[18px] text-ink-2">{user.handle}</div>
          </div>
          {user.bio && <p className="mt-3 text-[14px] leading-snug text-ink">{user.bio}</p>}

          <div className="mt-4">
            {isOwner ? (
              <Link
                href="/settings"
                className="inline-flex w-full items-center justify-center rounded-md border border-border px-4 py-2 text-[13px] font-semibold text-ink hover:border-border-strong"
              >
                {t('editProfile', lang)}
              </Link>
            ) : viewer ? (
              <FollowButton targetUserId={user.id} following={following} lang={lang} />
            ) : (
              <Link href="/login" className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg">
                {t('follow', lang)}
              </Link>
            )}
          </div>

          <div className="mt-3 flex gap-4 text-[13px]">
            <Link href={`/${handle}?tab=followers`} className="text-ink-2 hover:text-accent">
              <b className="text-ink">{followCounts.followers}</b> {t('followersLabel', lang)}
            </Link>
            <Link href={`/${handle}?tab=following`} className="text-ink-2 hover:text-accent">
              <b className="text-ink">{followCounts.following}</b> {t('followingLabel', lang)}
            </Link>
          </div>

          <div className="mt-3 font-mono text-[12px] text-muted">
            {t('joined', lang)}{' '}
            {new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', { year: 'numeric', month: 'short' }).format(
              new Date(user.createdAt),
            )}
          </div>
          <div className="mt-4 flex gap-4 text-[13px]">
            <span className="text-ink-2">
              <b className="text-ink">{counts.lists}</b> {t('lists', lang).toLowerCase()}
            </span>
            <span className="text-ink-2">
              <b className="text-ink">{counts.stars}</b> {t('starredTab', lang).toLowerCase()}
            </span>
          </div>

          {(user.location || user.website || user.socials.length > 0) && (
            <div className="mt-4 flex flex-col gap-2 text-[13px]">
              {user.location && (
                <div className="flex items-center gap-2 text-ink-2">
                  <MapPin size={15} className="shrink-0 text-muted" /> {user.location}
                </div>
              )}
              {user.website && (
                <a
                  href={user.website}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="flex items-center gap-2 text-accent hover:underline"
                >
                  <Link2 size={15} className="shrink-0 text-muted" /> <span className="truncate">{displayUrl(user.website)}</span>
                </a>
              )}
              {user.socials.map((s, i) => (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="flex items-center gap-2 text-ink-2 hover:text-ink"
                >
                  <SocialIcon type={s.type} className="shrink-0 text-muted" /> <span className="truncate">{socialLabel(s.type)}</span>
                </a>
              ))}
            </div>
          )}
        </aside>

        <section className="min-w-0 flex-1">
          {/* Топ-табы профиля как в GitHub: Overview / Lists / Stars / Catalogs. */}
          <div className="mb-6 flex gap-5 border-b border-border text-[14px] font-semibold">
            {isPeopleTab ? (
              <>
                <TabLink handle={handle} tab="followers" active={tab} label={`${t('followersLabel', lang)} ${followCounts.followers}`} />
                <TabLink handle={handle} tab="following" active={tab} label={`${t('followingLabel', lang)} ${followCounts.following}`} />
              </>
            ) : (
              <>
                <TabLink handle={handle} tab="overview" active={tab} label={t('overviewTab', lang)} />
                <TabLink handle={handle} tab="lists" active={tab} label={`${t('lists', lang)} ${counts.lists}`} />
                <TabLink handle={handle} tab="starred" active={tab} label={`${t('starredTab', lang)} ${counts.stars}`} />
                {catalogs.length > 0 && (
                  <TabLink handle={handle} tab="catalogs" active={tab} label={`${t('catalogsTab', lang)} ${catalogs.length}`} />
                )}
              </>
            )}
          </div>

          {/* Overview: закреплённые (Popular) + граф активности. */}
          {tab === 'overview' && (
            <>
              {pinned.length > 0 && (
                <div className="mb-6">
                  <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-2">
                    <Pin size={13} className="text-muted" /> {t('pinnedLabel', lang)}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {pinned.map((it) => {
                      const desc = tr(it.desc, lang)
                      return (
                        <Link
                          key={it.id}
                          href={`/${it.ownerHandle}/${it.slug}`}
                          className="group rounded-lg border border-border bg-surface px-3.5 py-3 hover:border-border-strong"
                        >
                          <div className="truncate text-[13.5px] font-semibold text-accent group-hover:underline">{tr(it.title, lang)}</div>
                          {desc && <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-ink-2">{desc}</p>}
                          <div className="mt-2 flex items-center gap-3 font-mono text-[11px] text-muted">
                            <span>★ {it.starsCount}</span>
                            <span>⑂ {it.forksCount}</span>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )}
              <ActivityGraph
                contributions={contributions}
                starsReceived={received.stars}
                forksReceived={received.forks}
                lang={lang}
              />
            </>
          )}

          {tab === 'overview' ? null : isPeopleTab ? (
            people.length === 0 ? (
              <Empty text={tab === 'followers' ? t('noFollowers', lang) : t('noFollowing', lang)} />
            ) : (
              <PeopleResults people={people} lang={lang} />
            )
          ) : tab === 'catalogs' ? (
            catalogs.length === 0 ? (
              <Empty text={t('noCatalogsYet', lang)} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {catalogs.map((c) => (
                  <Link
                    key={c.id}
                    href={`/${handle}/catalogs/${c.name}`}
                    className="group rounded-lg border border-border bg-surface px-4 py-3 hover:border-border-strong"
                  >
                    <div className="flex items-center gap-2">
                      <FolderGit2 size={15} className="text-muted" />
                      <span className="truncate font-semibold text-accent group-hover:underline">{tr(c.title, lang) || c.name}</span>
                    </div>
                    <div className="mt-1 font-mono text-[11.5px] text-muted">
                      {c.listCount} {t('lists', lang).toLowerCase()}
                    </div>
                  </Link>
                ))}
              </div>
            )
          ) : items.length === 0 ? (
            <Empty text={tab === 'starred' ? t('noStars', lang) : t('noProfileLists', lang)} />
          ) : (
            <FeedList items={items} lang={lang} viewerId={viewer?.userId} />
          )}
        </section>
      </div>
    </div>
  )
}

function TabLink({ handle, tab, active, label }: { handle: string; tab: Tab; active: Tab; label: string }) {
  const href = tab === 'overview' ? `/${handle}` : `/${handle}?tab=${tab}`
  return (
    <Link
      href={href}
      className={`pb-2.5 ${active === tab ? 'border-b-2 border-ink text-ink' : 'text-ink-2 hover:text-ink'}`}
    >
      {label}
    </Link>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border py-16 text-center text-[13.5px] text-muted">
      {text}
    </div>
  )
}
