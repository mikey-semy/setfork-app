import { Tag } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { listTags } from '@/features/tags/queries'
import { TagChip } from '@/shared/ui/TagChip'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('tags', lang) }
}

// Индекс тегов: все теги реестра чипами (курируемые/популярные выше) → /tags/[slug].
export default async function TagsIndexPage() {
  const lang = await getLang()  const tags = await listTags({ limit: 300 })

  return (
    <div className="mx-auto w-full max-w-[56.25rem] px-4 py-8">
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
