import { redirect } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { FeedList } from '@/features/library/FeedList'
import { getBookmarkedTemplates } from '@/features/library/queries'

export default async function BookmarksPage() {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  if (!session) redirect('/login')
  const items = await getBookmarkedTemplates(session.userId)
  const ru = lang === 'ru'

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-6">
      <h1 className="mb-4 text-[15px] font-semibold text-ink">{ru ? 'Закладки' : 'Saved'}</h1>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-[13.5px] text-muted">
          {ru ? 'Пока нет закладок.' : 'No saved lists yet.'}
        </div>
      ) : (
        <FeedList items={items} lang={lang} />
      )}
    </div>
  )
}
