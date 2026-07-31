import { Tag } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PageHeader } from '@/shared/ui/PageHeader'
import { listTags } from '@/features/tags/queries'
import { AdminTagsTable } from '@/features/tags/AdminTagsTable'

export const metadata = { title: 'Tags' }

export default async function AdminTagsPage() {
  await requireAdmin()
  const lang = await getLang()
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en)
  const tags = await listTags({ limit: 2000 })

  return (
    <div className="mx-auto w-full max-w-[53.75rem] px-6 py-8">
      <PageHeader
        icon={<Tag size={18} />}
        title={t('tags', lang)}
        subtitle={say('Tag registry: curate, rename, merge, delete, recompute usage.', 'Реестр тегов: курирование, переименование, слияние, удаление, пересчёт usage.')}
      />
      <AdminTagsTable tags={tags} lang={lang} />
    </div>
  )
}
