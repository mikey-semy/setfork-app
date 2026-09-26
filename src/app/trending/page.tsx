import { getLang } from '@/shared/i18n/server'
import { getSession } from '@/shared/auth/session'
import { t } from '@/shared/i18n'
import { PAGE } from '@/shared/ui/control'
import { FeedList } from '@/features/library/FeedList'
import { EmptyState } from '@/shared/ui/EmptyState'
import { getTrendingFeed } from '@/features/library/queries'

/** Тренды — ВИТРИНА, а не листалка: смысл страницы в верхушке, и «страница 7 трендов» его
 *  бы не имела. Потолок тот же, что показывался и раньше (30), но теперь он стоит в
 *  запросе: до этого страница грузила весь видимый корпус и отрезала от него тридцатку. */
const TREND_TOP = 30
import { ExploreNav } from '@/widgets/explore/ExploreNav'
import { TrendScope } from '@/widgets/explore/TrendControls'
import { pageMeta } from '@/shared/seo/page-meta'

// Популярные списки. Отдельный адрес, а не вкладка с параметрами: ссылку на
// «популярное за месяц» человек диктует и кладёт в закладки, а поисковик — индексирует.
// Так же разведены разделы у GitHub: /trending и /trending/developers.
export async function generateMetadata() {
  const lang = await getLang()
  return pageMeta({ title: t('trending', lang), path: '/trending' })
}

export default async function TrendingListsPage() {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  // ⚠️ ПЕРИОДА ЗДЕСЬ БОЛЬШЕ НЕТ, и это не упрощение ради упрощения. Порядок считался
  // как `звёзды за окно * 1000 + звёзды + форки`: при нуле новых звёзд первое слагаемое
  // тождественно ноль, и день/неделя/месяц давали ОДНУ И ТУ ЖЕ выдачу. Замер прода
  // 13.09.2026: 64 публичных списка, 2 звезды всего, 1 за месяц, форков ноль — то есть
  // переключатель предлагал выбор, которого не существует.
  //
  // Так же поступлено у соседей по разделу: на `/trending/people` фильтра по периоду
  // нет ровно потому, что «показывать неработающий фильтр было бы обманом».
  const lists = await getTrendingFeed('all', session?.userId, lang, { limit: TREND_TOP })

  return (
    <div className="w-full">
      {/* Заголовок страницы для диктора: видимого у этой страницы нет по замыслу,
          но без h1 человек не найдёт, где он оказался (WCAG 2.4.6, обход по заголовкам). */}
      <h1 className="sr-only">{t('trending', lang)}</h1>
      <ExploreNav active="trending" lang={lang} />
      <div className={PAGE}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <TrendScope active="lists" lang={lang} />
          {/* Чем собран порядок — сказано вслух: подпись «популярное» без этого читается
              как «выбрано редакцией» или «умный подбор». ⚠️ И сказано ПОЛНОСТЬЮ: первым
              ключом `keywordFeed` сортирует по языку зрителя (`langPref`), и только потом
              по звёздам и форкам — список без звёзд на языке зрителя стоит выше
              популярного без перевода. Первая редакция подписи («по звёздам и форкам»)
              об этом молчала и была неправдой; поймало авто-ревью. */}
          <p className="text-body-sm text-muted">{t('trendingOrderNote', lang)}</p>
        </div>
        {lists.length === 0 ? (
          <EmptyState variant="plain" hint={t('noProfileLists', lang)} />
        ) : (
          <FeedList items={lists} lang={lang} viewerId={session?.userId} className="space-y-3" />
        )}
      </div>
    </div>
  )
}
