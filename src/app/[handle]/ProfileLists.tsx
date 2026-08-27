import Link from 'next/link'
import { plural, t, tr } from '@/shared/i18n'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Pagination } from '@/shared/ui/Pagination'
import { FeedList } from '@/features/library/FeedList'
import { BulkSelection } from '@/features/library/bulk/BulkSelection'
import { SelectionToggle } from '@/features/library/bulk/SelectionToggle'
import { ListsToolbar } from '@/features/profile/ListsToolbar'
import type { ProfilePageData } from './load'

type Props = Pick<
  ProfilePageData,
  | 'handle'
  | 'lang'
  | 'tab'
  | 'isOwner'
  | 'viewer'
  | 'total'
  | 'allIds'
  | 'pageItems'
  | 'page'
  | 'totalPages'
  | 'pageHref'
  | 'starFolders'
  | 'fsort'
  | 'folder'
  | 'rawQuery'
  | 'sort'
  | 'listType'
  | 'catalogs'
  | 'catalogFilter'
  | 'unfiledCount'
  | 'unfilteredItemsCount'
>

/**
 * Вкладки «Списки» и «Звёзды»: папки звёзд, поиск с сортировкой, сама выдача и
 * страницы. Что попадает в выдачу — решено в load.ts; здесь только вид.
 */
export function ProfileLists({
  handle,
  lang,
  tab,
  isOwner,
  viewer,
  catalogs,
  catalogFilter,
  unfiledCount,
  total,
  allIds,
  pageItems,
  page,
  totalPages,
  pageHref,
  starFolders,
  fsort,
  folder,
  rawQuery,
  sort,
  listType,
  unfilteredItemsCount,
}: Props) {
  // Набор для пакетных действий собираем ЗДЕСЬ и один раз: и признак «можно», и данные для
  // полосы. Ниже остаётся один вопрос — есть он или нет.
  const bulk =
    isOwner && tab === 'lists'
      ? {
          catalogs: catalogs.map((c) => ({ name: c.name, title: tr(c.title, lang) })),
          // Набор для «выбрать все» приходит запросом: вся текущая выдача с потолком, а не
          // показанная страница — разбирать полтысячи списков по двадцать штук бессмысленно.
          allIds,
        }
      : null

  const toolbar =
    unfilteredItemsCount > 0 ? (
      <ListsToolbar
        tab={tab === 'starred' ? 'starred' : 'lists'}
        lang={lang}
        isOwner={isOwner}
        q={rawQuery}
        type={listType}
        sort={sort}
        catalogs={catalogs.map((c) => ({ name: c.name, title: tr(c.title, lang), count: c.listCount }))}
        catalog={catalogFilter}
        unfiledCount={unfiledCount}
        actions={isOwner && tab === 'lists' ? <SelectionToggle lang={lang} /> : null}
      />
    ) : null

  return (
    <>
      {/* Stars как у GitHub: секция папок (карточки + сорт), ниже поиск+сорт звёзд. */}
      {tab === 'starred' && starFolders.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-title font-semibold text-ink">
              {t('foldersLabel', lang)} <span className="font-mono text-body-sm text-muted">{starFolders.length}</span>
            </div>
            <div className="flex gap-1 text-body-sm">
              {(['name', 'count'] as const).map((s) => (
                <Link
                  key={s}
                  href={`/${handle}?tab=starred&fsort=${s}`}
                  className={`rounded px-2 py-0.5 ${fsort === s ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:text-ink'}`}
                >
                  {s === 'name' ? 'A-Z' : t('byCount', lang)}
                </Link>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {starFolders.map((f) => {
              const on = folder === f.name
              return (
                <Link
                  key={f.id}
                  href={on ? `/${handle}?tab=starred` : `/${handle}?tab=starred&folder=${encodeURIComponent(f.name)}`}
                  // eslint-disable-next-line no-restricted-syntax -- карточка папки, не контрол в ряду; padding задаёт содержательную область карточки.
                  className={`rounded-lg border px-4 py-3 ${on ? 'border-accent bg-accent/10' : 'border-border bg-surface hover:border-border-strong'}`}
                >
                  <div className="truncate text-body-lg font-semibold text-ink">{f.name}</div>
                  <div className="mt-1 font-mono text-caption text-muted">
                    {/* Существительное СКЛОНЯЕТСЯ: словарное `lists` — это заголовок
                        «Списки», и рядом с числом он давал «5 списки», «1 списки». На
                        английском ошибка видна только при единице («1 lists»), поэтому и
                        держалась. Формы уже лежат в PLURALS под тем же ключом. */}
                    {f.count} {plural(f.count, 'lists', lang)}
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {(!bulk || total === 0) && toolbar}

      {total === 0 ? (
        // ДВА РАЗНЫХ ПУСТО. «Списков пока нет» — про человека, «ничего не подошло» — про
        // фильтр. Раньше отфильтрованная в ноль библиотека из пятисот списков сообщала
        // владельцу, что у него их нет: неправда, и вдобавок скрывает, что виноват фильтр
        // и его можно снять. `/my-lists` этот раздел уже делает, а профиль — нет, хотя
        // `unfilteredItemsCount` лежит тут же в пропсах.
        <EmptyState
          hint={
            unfilteredItemsCount === 0
              ? tab === 'starred'
                ? t('noStars', lang)
                : t('noProfileLists', lang)
              : t('library.nothingMatchesQuery', lang)
          }
        />
      ) : bulk ? (
        // Пакетные действия — только над своей библиотекой: раскладывать по полкам и
        // публиковать можно лишь то, что твоё. «Все» — вся текущая выдача с фильтром, а не
        // одна страница: разбирать полтысячи списков по двадцать штук бессмысленно.
        <BulkSelection lang={lang} catalogs={bulk.catalogs} allIds={bulk.allIds} toolbar={toolbar}>
          <FeedList items={pageItems} lang={lang} viewerId={viewer?.userId} selectable />
          <Pagination page={page} totalPages={totalPages} total={total} makeHref={pageHref} lang={lang} />
        </BulkSelection>
      ) : (
        <>
          <FeedList items={pageItems} lang={lang} viewerId={viewer?.userId} />
          <Pagination page={page} totalPages={totalPages} total={total} makeHref={pageHref} lang={lang} />
        </>
      )}
    </>
  )
}
