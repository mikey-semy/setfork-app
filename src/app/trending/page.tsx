import { getLang } from '@/shared/i18n/server'
import { getSession } from '@/shared/auth/session'
import { t } from '@/shared/i18n'
import { PAGE } from '@/shared/ui/control'
import { FeedList } from '@/features/library/FeedList'
import { EmptyState } from '@/shared/ui/EmptyState'
import { getTrendingFeed, type TrendRange } from '@/features/library/queries'
import { ExploreNav } from '@/widgets/explore/ExploreNav'
import { TrendScope, TrendRanges, readRange } from '@/widgets/explore/TrendControls'

// Популярные списки. Отдельный адрес, а не вкладка с параметрами: ссылку на
// «популярное за месяц» человек диктует и кладёт в закладки, а поисковик — индексирует.
// Так же разведены разделы у GitHub: /trending и /trending/developers.
export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('trending', lang) }
}

export default async function TrendingListsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const [{ range }, lang, session] = await Promise.all([searchParams, getLang(), getSession()])
  // Период остаётся ПАРАМЕТРОМ: это фильтр одной и той же страницы, а не разные
  // страницы. У GitHub ровно так же — `?since=weekly`.
  const trendRange: TrendRange = readRange(range)
  const lists = await getTrendingFeed(trendRange, session?.userId, lang)

  return (
    <div className="w-full">
      <ExploreNav active="trending" lang={lang} />
      <div className={PAGE}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <TrendScope active="lists" range={trendRange} lang={lang} />
          <TrendRanges active={trendRange} lang={lang} />
        </div>
        {lists.length === 0 ? (
          <EmptyState variant="plain" hint={t('noProfileLists', lang)} />
        ) : (
          <FeedList items={lists.slice(0, 30)} lang={lang} viewerId={session?.userId} className="space-y-3" />
        )}
      </div>
    </div>
  )
}
