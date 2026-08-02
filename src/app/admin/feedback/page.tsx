import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PageHeader } from '@/shared/ui/PageHeader'
import { getFeedbackCounts, getFeedbackList, type FeedbackFilter } from '@/features/feedback/queries'
import { FeedbackTable } from '@/features/feedback/FeedbackTable'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('feedback', lang) }
}

export default async function AdminFeedbackPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireAdmin()
  const [{ filter: f }, lang] = await Promise.all([searchParams, getLang()])
  const filter: FeedbackFilter = f === 'new' || f === 'seen' || f === 'done' ? f : 'all'
  const [items, counts] = await Promise.all([getFeedbackList(filter), getFeedbackCounts()])

  return (
    <div className="min-w-0">
      <PageHeader title={t('feedback', lang)} subtitle={t('feedbackAdminIntro', lang)} />
      <FeedbackTable items={items} counts={counts} filter={filter} lang={lang} />
    </div>
  )
}
