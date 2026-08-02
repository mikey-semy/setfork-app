import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PageHeader } from '@/shared/ui/PageHeader'
import { FeedbackForm } from '@/features/feedback/FeedbackForm'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('feedback', lang) }
}

export default async function FeedbackPage() {
  const lang = await getLang()
  return (
    <div className="mx-auto w-full max-w-[35rem] px-6 py-12">
      {/* «Обратная связь» уже стоит в шапке приложения — остаётся вводное пояснение. */}
      <PageHeader hideTitle title={t('feedbackTitle', lang)} subtitle={t('feedbackIntro', lang)} />
      <FeedbackForm lang={lang} />
    </div>
  )
}
