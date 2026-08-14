import Link from 'next/link'
import { FolderGit2 } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { FeedList } from '@/features/library/FeedList'
import { Pagination } from '@/shared/ui/Pagination'
import { pageCount, pageFromParam, pageWindow } from '@/shared/lib/paging'
import { countUserTemplates, getUserTemplates } from '@/features/library/queries'
import { applySavedQuery, listSavedQueries } from '@/features/library/saved-queries'
import { PAGE } from '@/shared/ui/control'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('myLists', lang) }
}

export default async function MyListsPage({ searchParams }: { searchParams: Promise<{ sq?: string; page?: string }> }) {
  const [lang, session, sp] = await Promise.all([getLang(), getSession(), searchParams])
  // Сохранённые запросы (HQ §11): чипы-фильтры; ?sq=<id> применяется на сервере.
  const queries = session ? await listSavedQueries(session.userId) : []
  const activeQuery = sp.sq ? queries.find((q) => q.id === sp.sq) : undefined
  // Отбор сохранённым запросом считается ОТДЕЛЬНО и отдаёт только id — по ним же и режем
  // страницу. Раньше страница грузила всю библиотеку (у владельца это полтысячи списков с
  // аватарами), а фильтр применялся уже к загруженному.
  const keep = session && activeQuery ? [...(await applySavedQuery(session.userId, activeQuery))] : undefined
  const total = !session ? 0 : keep ? keep.length : await countUserTemplates(session.userId, session.userId)
  const totalPages = pageCount(total)
  const page = pageFromParam(sp.page, totalPages)
  const items = session ? await getUserTemplates(session.userId, session.userId, pageWindow(page), keep) : []
  // «Были ли списки вообще» — вопрос не про страницу: пустая вторая страница не означает
  // пустую библиотеку, и предлагать «создайте первый» там было бы неправдой.
  const hadAny = total > 0
  // Панель здоровья (HQ §11): «где болит прямо сейчас» — выше ленты.

  return (
    <div className={PAGE}>
          {/* Видимой шапки у страницы нет: заголовок «Списки» и «Новый список» уже стоят
              в TopNav (заголовок раздела слева, «+» справа) — второй раз то же самое
              отжимало ленту вниз. Заголовок остаётся для скринридеров и структуры. */}
          <PageHeader hideTitle title={t('myLists', lang)} />
          {!session ? (
            <div className="py-16 text-center text-[0.8125rem] text-muted">
              {t('loginRequired', lang)}{' '}
              <Link href="/login" className="font-semibold text-accent">
                {t('signIn', lang)}
              </Link>
            </div>
          ) : !hadAny ? (
            // Первый шаг новичка подсказывает само состояние, а не кнопка в углу
            // (линза 07): общий EmptyState с CTA вместо серой строки.
            <EmptyState
              icon={<FolderGit2 size={28} />}
              hint={t('emptyMyLists', lang)}
              action={{ href: '/new', label: t('newList', lang) }}
            />
          ) : (
            <>
              {/* Щиток здоровья и конструктор сохранённых запросов отсюда УБРАНЫ (решение
                  владельца 2026-07-29). «Мои списки» — страница, куда приходят открыть свой
                  список, а не настраивать выборку: два блока инструментов отжимали контент
                  вниз и требовали внимания раньше, чем сам список. Оба инструмента осмысленны,
                  когда списков сотни, — тогда им место в отдельном разделе, а не здесь.
                  Код фич не удалён: вернуть их дешевле, чем написать заново. */}
              {items.length === 0 ? (
                <div className="py-10 text-center text-[0.8125rem] text-muted">{t('library.nothingMatchesQuery', lang)}</div>
              ) : (
                <>
                  <FeedList items={items} lang={lang} viewerId={session.userId} />
                  <Pagination
                    page={page}
                    totalPages={totalPages}
                    makeHref={(p) => `/my-lists?${new URLSearchParams({ ...(sp.sq ? { sq: sp.sq } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`}
                    lang={lang}
                  />
                </>
              )}
            </>
          )}
    </div>
  )
}
