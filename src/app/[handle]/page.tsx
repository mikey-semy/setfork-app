import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Link2, MapPin } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { FeedList } from '@/features/library/FeedList'
import { getUserTemplates } from '@/features/library/queries'
import { getProfileCounts, getStarredTemplates, getUserByHandle } from '@/features/profile/queries'
import { avatarSrc } from '@/shared/media'
import { SocialIcon, socialLabel } from '@/features/settings/socials'

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

type Tab = 'lists' | 'starred'

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

  const tab: Tab = sp.tab === 'starred' ? 'starred' : 'lists'
  const counts = await getProfileCounts(user.id)
  const items = tab === 'starred' ? await getStarredTemplates(user.id) : await getUserTemplates(user.id)
  const bigAvatar = await avatarSrc(user.avatarUrl, 180)

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
          <div className="mb-4 flex gap-5 border-b border-border text-[14px] font-semibold">
            <TabLink handle={handle} tab="lists" active={tab} label={`${t('lists', lang)} ${counts.lists}`} />
            <TabLink handle={handle} tab="starred" active={tab} label={`${t('starredTab', lang)} ${counts.stars}`} />
          </div>

          {items.length === 0 ? (
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
  const href = tab === 'lists' ? `/${handle}` : `/${handle}?tab=${tab}`
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
