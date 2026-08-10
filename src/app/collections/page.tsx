import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PAGE } from '@/shared/ui/control'
import { EmptyState } from '@/shared/ui/EmptyState'
import { getCollections } from '@/features/collections/queries'
import { CollectionCard } from '@/features/collections/CollectionCard'
import { ExploreNav } from '@/widgets/explore/ExploreNav'

// Курируемые подборки. Раздел уже жил по адресу `/collections/<slug>`, а его
// оглавление пряталось за `?tab=collections` на чужой странице — теперь оно на
// своём месте.
export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('catalogsTab', lang) }
}

export default async function CollectionsPage() {
  const [lang, cards] = await Promise.all([getLang(), getCollections()])

  return (
    <div className="w-full">
      <ExploreNav active="collections" lang={lang} />
      <div className={PAGE}>
        {cards.length === 0 ? (
          <EmptyState variant="plain" hint={t('collectionsEmpty', lang)} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <CollectionCard key={c.id} c={c} lang={lang} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
