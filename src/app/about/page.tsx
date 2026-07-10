import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'

export const metadata = { title: 'About' }

export default async function AboutPage() {
  const lang = await getLang()
  return (
    <div className="mx-auto w-full max-w-[680px] px-6 py-12">
      <h1 className="mb-4 text-[22px] font-bold text-ink">{t('aboutProject', lang)}</h1>
      <p className="text-[14px] leading-relaxed text-ink-2">{t('aboutBody', lang)}</p>
    </div>
  )
}
