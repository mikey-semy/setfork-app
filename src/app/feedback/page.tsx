import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PageHeader } from '@/shared/ui/PageHeader'
import { FeedbackForm } from '@/features/feedback/FeedbackForm'

export const metadata = { title: 'Feedback' }

export default async function FeedbackPage() {
  const lang = await getLang()
  return (
    <div className="mx-auto w-full max-w-[35rem] px-6 py-12">
      <PageHeader title={t('feedbackTitle', lang)} subtitle={t('feedbackIntro', lang)} />
      <FeedbackForm lang={lang} />
    </div>
  )
}
