import Link from 'next/link'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { FeedList } from '@/features/library/FeedList'
import { getUserTemplates } from '@/features/library/queries'
import { applySavedQuery, listSavedQueries } from '@/features/library/saved-queries'

export const metadata = { title: 'My lists' }

export default async function MyListsPage({ searchParams }: { searchParams: Promise<{ sq?: string }> }) {
  const [lang, session, sp] = await Promise.all([getLang(), getSession(), searchParams])
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en) // строки-аргументами (i18n-lint)
  let items = session ? await getUserTemplates(session.userId, session.userId) : []
  const hadAny = items.length > 0
  // Сохранённые запросы (HQ §11): чипы-фильтры; ?sq=<id> применяется на сервере.
  const queries = session ? await listSavedQueries(session.userId) : []
  const activeQuery = sp.sq ? queries.find((q) => q.id === sp.sq) : undefined
  if (session && activeQuery) {
    const keep = await applySavedQuery(session.userId, activeQuery)
    items = items.filter((it) => keep.has(it.id))
  }
  // Панель здоровья (HQ §11): «где болит прямо сейчас» — выше ленты.

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
          ) : !hadAny ? (
            <div className="py-16 text-center text-[13.5px] text-muted">{t('emptyMyLists', lang)}</div>
          ) : (
            <>
              {/* Щиток здоровья и конструктор сохранённых запросов отсюда УБРАНЫ (решение
                  владельца 2026-07-29). «Мои списки» — страница, куда приходят открыть свой
                  список, а не настраивать выборку: два блока инструментов отжимали контент
                  вниз и требовали внимания раньше, чем сам список. Оба инструмента осмысленны,
                  когда списков сотни, — тогда им место в отдельном разделе, а не здесь.
                  Код фич не удалён: вернуть их дешевле, чем написать заново. */}
              {items.length === 0 ? (
                <div className="py-10 text-center text-[13.5px] text-muted">{say('Nothing matches this query', 'Под запрос ничего не попало')}</div>
              ) : (
                <FeedList items={items} lang={lang} viewerId={session.userId} />
              )}
            </>
          )}
    </div>
  )
}
