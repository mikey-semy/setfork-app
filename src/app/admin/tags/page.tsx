import Link from 'next/link'
import { ArrowLeft, Tag } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { listTags } from '@/features/tags/queries'
import { AdminTagsTable } from '@/features/tags/AdminTagsTable'

export const metadata = { title: 'Tags' }

export default async function AdminTagsPage() {
  await requireAdmin()
  const lang = await getLang()
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en)
  const tags = await listTags({ limit: 2000 })

  return (
    <div className="mx-auto w-full max-w-[860px] px-6 py-8">
      <Link href="/admin" className="mb-4 inline-flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> Admin
      </Link>
      <h1 className="mb-1 flex items-center gap-2 text-[18px] font-bold text-ink">
        <Tag size={18} /> {t('tags', lang)}
      </h1>
      <p className="mb-5 text-[13px] text-ink-2">{say('Tag registry: curate, rename, merge, delete, recompute usage.', 'Реестр тегов: курирование, переименование, слияние, удаление, пересчёт usage.')}</p>
      <AdminTagsTable tags={tags} lang={lang} />
    </div>
  )
}
