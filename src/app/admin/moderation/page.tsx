import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { getModerationCounts, getModerationList, type ModFilter } from '@/features/moderation/queries'
import { ModerationTable } from '@/features/moderation/ModerationTable'

export default async function ModerationPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireAdmin()
  const [{ filter: f }, lang] = await Promise.all([searchParams, getLang()])
  const filter: ModFilter = f === 'pending' || f === 'flagged' || f === 'hidden' ? f : 'all'
  const [items, counts] = await Promise.all([getModerationList(filter), getModerationCounts()])

  return (
    <div className="mx-auto w-full max-w-[860px] px-6 py-8">
      <Link href="/admin" className="mb-4 inline-flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> Admin
      </Link>
      <h1 className="mb-1 text-[18px] font-bold text-ink">{t('moderation', lang)}</h1>
      <p className="mb-5 text-[13px] text-ink-2">{t('moderationIntro', lang)}</p>
      <ModerationTable items={items} counts={counts} filter={filter} lang={lang} />
    </div>
  )
}
