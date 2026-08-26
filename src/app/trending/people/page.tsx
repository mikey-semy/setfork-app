import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PAGE } from '@/shared/ui/control'
import { searchPeople } from '@/features/profile/search'
import { PeopleResults } from '@/features/profile/PeopleResults'
import { ExploreNav } from '@/widgets/explore/ExploreNav'
import { TrendScope } from '@/widgets/explore/TrendControls'

// Популярные люди. Отдельный адрес — как `/trending/developers` у GitHub.
// Фильтра по периоду здесь НЕТ: список строится по числу подписчиков, а не по
// приросту за отрезок, и показывать неработающий фильтр было бы обманом.
export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('popularPeople', lang) }
}

export default async function TrendingPeoplePage() {
  const [lang, people] = await Promise.all([getLang(), searchPeople({ sort: 'followers', limit: 30 })])

  return (
    <div className="w-full">
      {/* Заголовок страницы для диктора: видимого у этой страницы нет по замыслу,
          но без h1 человек не найдёт, где он оказался (WCAG 2.4.6, обход по заголовкам). */}
      <h1 className="sr-only">{t('popularPeople', lang)}</h1>
      <ExploreNav active="trending" lang={lang} />
      <div className={PAGE}>
        <div className="mb-5">
          <TrendScope active="people" range="week" lang={lang} />
        </div>
        <PeopleResults people={people} lang={lang} />
      </div>
    </div>
  )
}
