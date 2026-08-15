import { Tag } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { getPopularTags } from '@/features/library/queries'
import { TagChip } from '@/shared/ui/TagChip'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { PAGE } from '@/shared/ui/control'
import { ExploreNav } from '@/widgets/explore/ExploreNav'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('tags', lang) }
}

// Популярные теги считаются по реально видимым публичным спискам. Реестр тегов
// хранит редакторские метаданные, но его usageCount может отставать от корпуса.
export default async function TagsIndexPage() {
  // Независимые запросы — параллельно (react-doctor).
  const [lang, tags] = await Promise.all([getLang(), getPopularTags(300)])

  return (
    // Навигация раздела «открытие» — та же, что на /explore, /trending и /collections:
    // страница теперь одна из его вкладок, и уходить с неё человек должен так же.
    <div className="w-full">
      <ExploreNav active="tags" lang={lang} />
      <div className={PAGE}>
        {/* «Теги» уже написаны в шапке приложения — на странице остаётся пояснение. */}
        <PageHeader hideTitle title={t('tags', lang)} subtitle={t('tags.browseListsByTag', lang)} />
        {tags.length ? (
          <div className="flex flex-wrap gap-2">
            {tags.map((tg) => (
              <TagChip key={tg.tag} slug={tg.tag} count={tg.count} className="px-3 py-1 text-[0.8125rem]" />
            ))}
          </div>
        ) : (
          <EmptyState icon={<Tag size={28} />} title={t('tags.noTagsYet', lang)} />
        )}
      </div>
    </div>
  )
}
