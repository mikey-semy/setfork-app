import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PAGE } from '@/shared/ui/control'
import { EmptyState } from '@/shared/ui/EmptyState'
import { getCollections } from '@/features/collections/queries'
import { CollectionCard } from '@/features/collections/CollectionCard'
import { ExploreNav } from '@/widgets/explore/ExploreNav'
import { pageMeta } from '@/shared/seo/page-meta'

// Курируемые подборки. Раздел уже жил по адресу `/collections/<slug>`, а его
// оглавление пряталось за `?tab=collections` на чужой странице — теперь оно на
// своём месте.
export async function generateMetadata() {
  const lang = await getLang()
  return pageMeta({ title: t('catalogsTab', lang), path: '/collections' })
}

export default async function CollectionsPage() {
  const [lang, cards] = await Promise.all([getLang(), getCollections()])

  return (
    <div className="w-full">
      {/* Заголовок страницы для диктора: видимого у этой страницы нет по замыслу,
          но без h1 человек не найдёт, где он оказался (WCAG 2.4.6, обход по заголовкам). */}
      <h1 className="sr-only">{t('catalogsTab', lang)}</h1>
      <ExploreNav active="collections" lang={lang} />
      <div className={PAGE}>
        {cards.length === 0 ? (
          <EmptyState variant="plain" hint={t('collectionsEmpty', lang)} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <CollectionCard key={c.id} c={c} lang={lang} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
