import Link from 'next/link'
import { FolderGit2 } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { FeedList } from '@/features/library/FeedList'
import { Pagination } from '@/shared/ui/Pagination'
import { pageCount, pageFromParam, pageHref, pageWindow } from '@/shared/lib/paging'
import { countUserTemplates } from '@/features/library/queries'
import { getProfileListPage, type ProfileListSort, type ProfileListType } from '@/features/library/queries/profile-lists'
import { applySavedQuery, listSavedQueries } from '@/features/library/saved-queries'
import { ListsToolbar } from '@/features/profile/ListsToolbar'
import { DENSITY_COOKIE, densityFrom } from '@/shared/lib/list-density'
import { cookies } from 'next/headers'
import { PAGE } from '@/shared/ui/control'

const TYPES: ProfileListType[] = ['all', 'public', 'private', 'draft', 'forks']
const SORTS: ProfileListSort[] = ['recent', 'name', 'stars']

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('myLists', lang) }
}

export default async function MyListsPage({
  searchParams,
}: {
  searchParams: Promise<{ sq?: string; page?: string; q?: string; type?: string; sort?: string }>
}) {
  const [lang, session, sp] = await Promise.all([getLang(), getSession(), searchParams])
  // ⚠️ ПОИСК И ФИЛЬТРЫ ЗДЕСЬ — ТЕ ЖЕ, ЧТО НА ВКЛАДКЕ ПРОФИЛЯ, и это не совпадение.
  // Страница показывает ровно тот же набор — свои списки, — и владелец справедливо
  // спросил (02.09.2026), почему в профиле искать можно, а в разделе «Мои списки» нет.
  // Своя панель и свой запрос означали бы два разных ответа на один вопрос: у профиля
  // поиск идёт по названию и адресу, а фильтр различает черновик и приватный по
  // состоянию, а не по полю `visibility` (см. profile-lists). Повторить это второй раз
  // без расхождений нельзя — поэтому берётся то же самое.
  const rawQuery = sp.q?.trim() ?? ''
  const listType = (TYPES as string[]).includes(sp.type ?? '') ? (sp.type as ProfileListType) : 'all'
  const sort = (SORTS as string[]).includes(sp.sort ?? '') ? (sp.sort as ProfileListSort) : 'recent'
  const density = densityFrom((await cookies()).get(DENSITY_COOKIE)?.value)
  // Сохранённые запросы (HQ §11): чипы-фильтры; ?sq=<id> применяется на сервере.
  const queries = session ? await listSavedQueries(session.userId) : []
  const activeQuery = sp.sq ? queries.find((q) => q.id === sp.sq) : undefined
  // Отбор сохранённым запросом считается ОТДЕЛЬНО и отдаёт только id — по ним же и режем
  // страницу. Раньше страница грузила всю библиотеку (у владельца это полтысячи списков с
  // аватарами), а фильтр применялся уже к загруженному.
  const keep = session && activeQuery ? [...(await applySavedQuery(session.userId, activeQuery))] : undefined
  // Два разных счёта, и путать их нельзя. `owned` отвечает на «есть ли у меня списки
  // вообще» — по нему решается, показать ли приглашение создать первый. `total` — сколько
  // строк в ТЕКУЩЕЙ выдаче, по нему считаются страницы. Слить их значило бы предлагать
  // «создайте первый список» человеку, у которого их полтысячи, просто фильтр не совпал
  // (находка авто-ревью).
  const owned = session ? await countUserTemplates(session.userId, session.userId) : 0
  const filter = session
    ? {
        ownerId: session.userId,
        viewerId: session.userId,
        tab: 'lists' as const,
        query: rawQuery || undefined,
        listType,
        sort,
        // Сохранённый запрос сужает набор ВМЕСТЕ с поиском и фильтром, а не вместо них:
        // иначе `?sq=` тихо перестал бы работать при переходе на общую выборку.
        ids: keep,
      }
    : null
  // Число страниц считается по ТОМУ ЖЕ отбору, что и выдача: `getProfileListPage` отдаёт
  // страницу и её объём одним ответом — разойтись им нечем.
  const firstPass = filter ? await getProfileListPage(filter, pageWindow(1)) : { items: [], total: 0 }
  const total = firstPass.total
  const totalPages = pageCount(total)
  const page = pageFromParam(sp.page, totalPages)
  const items =
    filter && page > 1 ? (await getProfileListPage(filter, pageWindow(page), firstPass.total)).items : firstPass.items
  const hadAny = owned > 0
  // Панель здоровья (HQ §11): «где болит прямо сейчас» — выше ленты.

  return (
    <div className={PAGE}>
          {/* Видимой шапки у страницы нет: заголовок «Списки» и «Новый список» уже стоят
              в TopNav (заголовок раздела слева, «+» справа) — второй раз то же самое
              отжимало ленту вниз. Заголовок остаётся для скринридеров и структуры. */}
          <PageHeader hideTitle title={t('myLists', lang)} />
          {!session ? (
            <div className="py-16 text-center text-body text-muted">
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
              {/* Панель — общая с профилем: поиск, состояние списка, порядок, плотность. */}
              <ListsToolbar tab="lists" lang={lang} isOwner q={rawQuery} type={listType} sort={sort} density={density} />
              {items.length === 0 ? (
                <div className="py-10 text-center text-body text-muted">{t('library.nothingMatchesQuery', lang)}</div>
              ) : (
                <>
                  <FeedList items={items} lang={lang} viewerId={session.userId} />
                  <Pagination
                    page={page}
                    totalPages={totalPages}
                    makeHref={pageHref('/my-lists', sp)}
                    lang={lang}
                  />
                </>
              )}
            </>
          )}
    </div>
  )
}
