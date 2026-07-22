import Link from 'next/link'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { FeedList } from '@/features/library/FeedList'
import { getUserTemplates } from '@/features/library/queries'
import { listsHealth } from '@/features/library/health'
import { HealthBoard } from '@/features/library/HealthBoard'

export const metadata = { title: 'My lists' }

export default async function MyListsPage() {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const items = session ? await getUserTemplates(session.userId, session.userId) : []
  // Панель здоровья (HQ §11): «где болит прямо сейчас» — выше ленты.
  const health = session ? await listsHealth(session.userId) : []

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-6">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-[15px] font-semibold text-ink">{t('myLists', lang)}</h1>
            <Link href="/new" className="rounded-md bg-primary px-3 py-2 text-[13px] font-semibold text-primary-fg">
              {t('newList', lang)}
            </Link>
          </div>
          {!session ? (
            <div className="py-16 text-center text-[13.5px] text-muted">
              {t('loginRequired', lang)}{' '}
              <Link href="/login" className="font-semibold text-accent">
                {t('signIn', lang)}
              </Link>
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-[13.5px] text-muted">{t('emptyMyLists', lang)}</div>
          ) : (
            <>
              <HealthBoard items={health} lang={lang} ownerHandle={session.handle} />
              <FeedList items={items} lang={lang} viewerId={session.userId} />
            </>
          )}
    </div>
  )
}
