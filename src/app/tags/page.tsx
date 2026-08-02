import { Tag } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { listTags } from '@/features/tags/queries'
import { TagChip } from '@/shared/ui/TagChip'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { PAGE } from '@/shared/ui/control'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('tags', lang) }
}

// Индекс тегов: все теги реестра чипами (курируемые/популярные выше) → /tags/[slug].
export default async function TagsIndexPage() {
  // Независимые запросы — параллельно (react-doctor).
  const [lang, tags] = await Promise.all([getLang(), listTags({ limit: 300 })])

  return (
    <div className={PAGE}>
      <PageHeader
        icon={<Tag size={18} />}
        title={t('tags', lang)}
        subtitle={t('tags.browseListsByTag', lang)}
      />
      {tags.length ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tg) => (
            <TagChip
              key={tg.slug}
              slug={tg.slug}
              label={tg.label ?? undefined}
              count={tg.usageCount}
              curated={tg.curated}
              className="px-3 py-1 text-[0.8125rem]"
            />
          ))}
        </div>
      ) : (
        <EmptyState icon={<Tag size={28} />} title={t('tags.noTagsYet', lang)} />
      )}
    </div>
  )
}
