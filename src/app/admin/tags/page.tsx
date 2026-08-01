import { Tag } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PageHeader } from '@/shared/ui/PageHeader'
import { listTags } from '@/features/tags/queries'
import { AdminTagsTable } from '@/features/tags/AdminTagsTable'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('tags', lang) }
}

export default async function AdminTagsPage() {
  await requireAdmin()
  // Независимые запросы — параллельно (react-doctor).
  const [lang, tags] = await Promise.all([getLang(), listTags({ limit: 2000 })])

  return (
    <div className="mx-auto w-full max-w-[53.75rem] px-6 py-8">
      <PageHeader
        icon={<Tag size={18} />}
        title={t('tags', lang)}
        subtitle={t('admin.tagRegistryCurateRename', lang)}
      />
      <AdminTagsTable tags={tags} lang={lang} />
    </div>
  )
}
