import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { FeedCard } from '@/features/library/FeedCard'
import { getUserTemplates } from '@/features/library/queries'
import { getProfileCounts, getStarredTemplates, getUserByHandle } from '@/features/profile/queries'

type Tab = 'lists' | 'liked'

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const [{ handle }, sp, lang] = await Promise.all([params, searchParams, getLang()])
  const user = await getUserByHandle(handle)
  if (!user) notFound()

  const tab: Tab = sp.tab === 'liked' ? 'liked' : 'lists'
  const counts = await getProfileCounts(user.id)

  return (
    <div className="w-full px-6 py-8 lg:px-8">
      <div className="mx-auto flex max-w-[980px] flex-col gap-8 md:flex-row">
        {/* Sidebar: аватар + идентичность */}
        <aside className="flex-shrink-0 md:w-[280px]">
          <Avatar handle={user.handle} avatarUrl={user.avatarUrl} size={180} rounded="rounded-2xl" />
          <div className="mt-4">
            {user.name && <div className="text-[22px] font-bold leading-tight text-ink">{user.name}</div>}
            <div className="text-[18px] text-ink-2">{user.handle}</div>
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
              <b className="text-ink">{counts.stars}</b> {t('liked', lang).toLowerCase()}
            </span>
          </div>
        </aside>

        {/* Main: вкладки + контент */}
        <section className="min-w-0 flex-1">
          <div className="mb-4 flex gap-5 border-b border-border text-[14px] font-semibold">
            <TabLink handle={handle} tab="lists" active={tab} label={`${t('lists', lang)} ${counts.lists}`} />
            <TabLink handle={handle} tab="liked" active={tab} label={`${t('liked', lang)} ${counts.stars}`} />
          </div>

          {tab === 'lists' ? (
            <ListsTab userId={user.id} lang={lang} />
          ) : (
            <StarredTab userId={user.id} lang={lang} />
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

async function ListsTab({ userId, lang }: { userId: string; lang: 'en' | 'ru' }) {
  const items = await getUserTemplates(userId)
  if (items.length === 0) return <Empty text={t('noProfileLists', lang)} />
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <FeedCard key={item.id} item={item} lang={lang} />
      ))}
    </div>
  )
}

async function StarredTab({ userId, lang }: { userId: string; lang: 'en' | 'ru' }) {
  const items = await getStarredTemplates(userId)
  if (items.length === 0) return <Empty text={t('noStars', lang)} />
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <FeedCard key={item.id} item={item} lang={lang} />
      ))}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border py-16 text-center text-[13.5px] text-muted">
      {text}
    </div>
  )
}
