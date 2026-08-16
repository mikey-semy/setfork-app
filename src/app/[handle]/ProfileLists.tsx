import Link from 'next/link'
import { t, tr } from '@/shared/i18n'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Pagination } from '@/shared/ui/Pagination'
import { FeedList } from '@/features/library/FeedList'
import { BulkSelection } from '@/features/library/bulk/BulkSelection'
import { SelectionToggle } from '@/features/library/bulk/SelectionToggle'
import { BULK_MAX } from '@/features/library/bulk/limits'
import { ListsToolbar } from '@/features/profile/ListsToolbar'
import type { ProfilePageData } from './load'

type Props = Pick<
  ProfilePageData,
  | 'handle'
  | 'lang'
  | 'tab'
  | 'isOwner'
  | 'viewer'
  | 'items'
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
  items,
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
          allIds: items.slice(0, BULK_MAX).map((i) => i.id),
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
            <div className="text-[1rem] font-semibold text-ink">
              {t('foldersLabel', lang)} <span className="font-mono text-[0.78125rem] text-muted">{starFolders.length}</span>
            </div>
            <div className="flex gap-1 text-[0.78125rem]">
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
                  <div className="truncate text-[0.875rem] font-semibold text-ink">{f.name}</div>
                  <div className="mt-1 font-mono text-[0.6875rem] text-muted">
                    {f.count} {t('lists', lang).toLowerCase()}
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {(!bulk || items.length === 0) && toolbar}

      {items.length === 0 ? (
        <EmptyState hint={tab === 'starred' ? t('noStars', lang) : t('noProfileLists', lang)} />
      ) : bulk ? (
        // Пакетные действия — только над своей библиотекой: раскладывать по полкам и
        // публиковать можно лишь то, что твоё. «Все» — вся текущая выдача с фильтром, а не
        // одна страница: разбирать полтысячи списков по двадцать штук бессмысленно.
        <BulkSelection lang={lang} catalogs={bulk.catalogs} allIds={bulk.allIds} toolbar={toolbar}>
          <FeedList items={pageItems} lang={lang} viewerId={viewer?.userId} selectable />
          <Pagination page={page} totalPages={totalPages} makeHref={pageHref} lang={lang} />
        </BulkSelection>
      ) : (
        <>
          <FeedList items={pageItems} lang={lang} viewerId={viewer?.userId} />
          <Pagination page={page} totalPages={totalPages} makeHref={pageHref} lang={lang} />
        </>
      )}
    </>
  )
}
