import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { FeedbackForm } from '@/features/feedback/FeedbackForm'

export const metadata = { title: 'Feedback' }

export default async function FeedbackPage() {
  const lang = await getLang()
  return (
    <div className="mx-auto w-full max-w-[560px] px-6 py-12">
      <h1 className="mb-1 text-[22px] font-bold text-ink">{t('feedbackTitle', lang)}</h1>
      <p className="mb-6 text-[13.5px] text-ink-2">{t('feedbackIntro', lang)}</p>
      <FeedbackForm lang={lang} />
    </div>
  )
}
