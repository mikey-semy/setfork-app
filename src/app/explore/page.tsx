import Link from 'next/link'
import { ChevronRight, Star, Users } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { FeedCard } from '@/features/library/FeedCard'
import { getFeed, getStarredIds, getTrendingFeed, type TrendRange } from '@/features/library/queries'
import { getPublicCatalogs } from '@/features/catalogs/queries'
import { CatalogRow } from '@/features/catalogs/CatalogRow'
import { searchPeople } from '@/features/profile/search'
import { ExploreNav } from '@/widgets/explore/ExploreNav'
import { PAGE } from '@/shared/ui/control'
import { cardClass } from '@/shared/ui/card-style'
import { pageMeta } from '@/shared/seo/page-meta'

// Витрина-открытие (не поиск!). Соседние разделы — теги, популярное и подборки —
// живут по СВОИМ адресам (/tags, /trending, /collections), как у GitHub; здесь
// осталась только сама витрина.

/** Период ссылки «ещё» из бокового виджета: неделя, а не день — за сутки бывает пусто. */
const SIDE_TREND_RANGE: TrendRange = 'week'
/** Сколько карточек в основной ленте витрины и сколько в боковом виджете. Числа стоят
 *  рядом с местом, где они видны, и уезжают в САМ запрос: витрина показывает верх выдачи,
 *  и грузить ради него весь корпус незачем. */
const EXPLORE_FEED = 12
const EXPLORE_SIDE = 5

export async function generateMetadata() {
  const lang = await getLang()
  // Canonical у обзора — по той же причине, что у корня: страница принимает параметры
  // (прежние `?tab=` перенаправляет middleware), и каждый из них без этой строки
  // выглядел бы для обходчика отдельной страницей с тем же содержимым.
  return pageMeta({ title: t('explore', lang), description: t('heroSub', lang), path: '/explore' })
}

export default async function ExplorePage() {
  // Прежние адреса вкладок (`?tab=`) перенаправляет middleware: у этой страницы есть
  // loading.tsx, то есть потоковая отдача, и заголовки уходят клиенту ДО рендера —
  // `redirect()` отсюда физически не может сменить статус ответа (тот же случай, что
  // с notFound() на профиле: страница «не найдено» уезжала с кодом 200).
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const uid = session?.userId
  // Четыре независимых чтения — одной волной, а не в затылок друг другу.
  // Каталоги идут в ОСНОВНОЙ ленте рядом со списками (не отдельной вкладкой), а виджет
  // показывает ТО ЖЕ, куда ведёт его ссылка: тот же запрос и тот же период. Лента
  // страницы ранжируется иначе (звёзды за всё время), и наполнять ею виджет с подписью
  // «Trending» значило бы обещать одно, а по клику показывать другое.
  const [feed, exploreCatalogs, sidePeople, sideTrending] = await Promise.all([
    // Витрине нужен ВЕРХ выдачи, а не вся она: раньше запрос тянул весь видимый корпус с
    // аватарами авторов, а показывались двенадцать. Числа те же, что и были, — теперь они
    // стоят в запросе, а не в разметке.
    getFeed({ sort: 'trending' }, uid, lang, { limit: EXPLORE_FEED }),
    getPublicCatalogs(6),
    searchPeople({ sort: 'followers', limit: 5 }),
    getTrendingFeed(SIDE_TREND_RANGE, uid, lang, { limit: EXPLORE_SIDE }),
  ])
  const feedTop = feed
  // Звёзды зависят от того, что попало в ленту, — только это чтение и ждёт её.
  const feedStarred = uid ? await getStarredIds(uid, feedTop.map((i) => i.id)) : new Set<string>()

  return (
    <div className="w-full">
      {/* Заголовок страницы для диктора: видимого у этой страницы нет по замыслу,
          но без h1 человек не найдёт, где он оказался (WCAG 2.4.6, обход по заголовкам). */}
      <h1 className="sr-only">{t('explore', lang)}</h1>
      <ExploreNav active="explore" lang={lang} />
      <div className={PAGE}>

      {/* Лента + сайдбар виджетов. */}
      <div className="flex flex-col gap-8 lg:flex-row">
          <div className="min-w-0 flex-1">
            {/* Единая лента в ОДИН столбец (как список репозиториев GitHub):
                каталоги (до 4) строками рядом со списками. Обложки — только у тех,
                у кого они реально есть; синтетических баннеров нет. */}
            <div className="flex flex-col gap-3">
              {exploreCatalogs.slice(0, 4).map((cat) => (
                <CatalogRow key={cat.id} c={cat} lang={lang} />
              ))}
              {feedTop.map((it) => (
                <FeedCard key={it.id} item={it} lang={lang} starred={feedStarred.has(it.id)} />
              ))}
            </div>
          </div>
          <aside className="w-full shrink-0 space-y-6 lg:w-panel-lg">
            <Widget
              title={t('trending', lang)}
              icon={<Star size={14} className="text-accent" />}
              moreHref={`/explore?tab=trending&view=lists&range=${SIDE_TREND_RANGE}`}
              moreLabel={t('trendingListsMore', lang)}
            >
              {sideTrending.map((l) => (
                <Link
                  key={l.id}
                  href={`/${l.ownerHandle}/${l.slug}`}
                  className="flex min-h-11 items-center justify-between gap-2 py-1.5 hover:text-accent"
                >
                  {/* Обрезается ВЛАДЕЛЕЦ, название видно целиком — приём GitHub
                      («semantica… / semantica»). Раньше `truncate` стоял на всей строке
                      и съедал ровно название, то есть единственное, ради чего строку
                      читают: «miki/Дело о таинственном майнер…». */}
                  <span className="flex min-w-0 flex-1 items-baseline gap-0.5 text-body">
                    <span className="max-w-18 shrink truncate text-muted">{l.ownerHandle}</span>
                    <span className="shrink-0 text-muted">/</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-ink-2">{tr(l.title, lang)}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-body-sm text-muted">
                    <Star size={12} /> {l.starsCount}
                  </span>
                </Link>
              ))}
            </Widget>
            <Widget
              title={t('popularPeople', lang)}
              icon={<Users size={14} className="text-accent" />}
              // У людей фильтра по периоду нет — страница показывает их без диапазона.
              moreHref="/explore?tab=trending&view=people"
              moreLabel={t('trendingPeopleMore', lang)}
            >
              {sidePeople.map((p) => (
                <Link key={p.handle} href={`/${p.handle}`} className="flex min-h-11 items-center gap-2 py-1.5">
                  <Avatar handle={p.handle} avatarUrl={p.avatarUrl} size={26} />
                  {/* Имя и ник — каждое своей строкой с обрезкой: длинное имя не должно
                      ни распирать колонку, ни выталкивать ник. */}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-ink">{p.name ?? p.handle}</span>
                    <span className="block truncate text-body-sm text-muted">@{p.handle}</span>
                  </span>
                </Link>
              ))}
            </Widget>
          </aside>
      </div>
      </div>
    </div>
  )
}

/**
 * Боковой виджет: заголовок, строки и — если есть куда — ссылка «ещё» внизу.
 *
 * Ссылка не украшение: виджет показывает пять строк из десятков, и без выхода на
 * полную страницу список выглядит исчерпывающим. Так же устроены виджеты GitHub
 * («See more trending repositories →»).
 */
function Widget({
  title,
  icon,
  children,
  moreHref,
  moreLabel,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  moreHref?: string
  moreLabel?: string
}) {
  return (
    <section className={cardClass()}>
      <div className="mb-1.5 flex items-center gap-2 text-body font-semibold text-ink">
        {icon} {title}
      </div>
      {/* Разделители строк — приглушённые, не ярче границ карточки. */}
      <div className="divide-y divide-border/40">{children}</div>
      {moreHref && moreLabel && (
        <Link
          href={moreHref}
          className="mt-1 flex min-h-11 items-center gap-1 border-t border-border/40 pt-2 text-body-sm font-medium text-accent hover:underline"
        >
          {moreLabel} <ChevronRight size={13} className="shrink-0" />
        </Link>
      )}
    </section>
  )
}
