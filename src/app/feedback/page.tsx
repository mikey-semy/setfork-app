import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PageHeader } from '@/shared/ui/PageHeader'
import { FeedbackForm } from '@/features/feedback/FeedbackForm'
import { PAGE } from '@/shared/ui/control'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('feedback', lang) }
}

export default async function FeedbackPage() {
  const lang = await getLang()
  return (
    <div className={PAGE}>
      <PageHeader title={t('feedbackTitle', lang)} subtitle={t('feedbackIntro', lang)} />
      <FeedbackForm lang={lang} />
    </div>
  )
}
