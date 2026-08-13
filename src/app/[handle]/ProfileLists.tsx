import Link from 'next/link'
import { t, tr } from '@/shared/i18n'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Pagination } from '@/shared/ui/Pagination'
import { FeedList } from '@/features/library/FeedList'
import { BulkSelection } from '@/features/library/bulk/BulkSelection'
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
  | 'query'
  | 'rawQuery'
  | 'sort'
  | 'listType'
  | 'catalogs'
  | 'catalogFilter'
  | 'unfiledCount'
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
  query,
  rawQuery,
  sort,
  listType,
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

      {tab === 'starred' && (
        <form action={`/${handle}`} className="mb-4 flex flex-wrap items-center gap-2">
          <input type="hidden" name="tab" value="starred" />
          {folder && <input type="hidden" name="folder" value={folder} />}
          <input
            name="q"
            defaultValue={rawQuery}
            placeholder={t('searchStarsPh', lang)}
            className="min-w-[11.25rem] flex-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[0.8125rem] text-ink outline-hidden focus:border-border-strong"
          />
          <div className="flex gap-1 text-[0.78125rem]">
            {(['recent', 'name', 'stars'] as const).map((s) => (
              <Link
                key={s}
                href={`/${handle}?tab=starred${folder ? `&folder=${encodeURIComponent(folder)}` : ''}${query ? `&q=${encodeURIComponent(rawQuery)}` : ''}&sort=${s}`}
                className={`rounded px-2 py-0.5 ${sort === s ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:text-ink'}`}
              >
                {s === 'recent' ? t('sortRecent', lang) : s === 'name' ? 'A-Z' : '★'}
              </Link>
            ))}
          </div>
        </form>
      )}

      {tab === 'lists' && (
        <ListsToolbar
          lang={lang}
          isOwner={isOwner}
          q={rawQuery}
          type={listType}
          sort={sort}
          catalogs={catalogs.map((c) => ({ name: c.name, title: tr(c.title, lang), count: c.listCount }))}
          catalog={catalogFilter}
          unfiledCount={unfiledCount}
        />
      )}

      {items.length === 0 ? (
        <EmptyState hint={tab === 'starred' ? t('noStars', lang) : t('noProfileLists', lang)} />
      ) : bulk ? (
        // Пакетные действия — только над своей библиотекой: раскладывать по полкам и
        // публиковать можно лишь то, что твоё. «Все» — вся текущая выдача с фильтром, а не
        // одна страница: разбирать полтысячи списков по двадцать штук бессмысленно.
        <BulkSelection lang={lang} catalogs={bulk.catalogs} allIds={bulk.allIds}>
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
