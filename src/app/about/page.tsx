import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PageHeader } from '@/shared/ui/PageHeader'

export const metadata = { title: 'About' }

export default async function AboutPage() {
  const lang = await getLang()
  return (
    <div className="mx-auto w-full max-w-[680px] px-6 py-12">
      <PageHeader title={t('aboutProject', lang)} />
      <p className="text-[14px] leading-relaxed text-ink-2">{t('aboutBody', lang)}</p>
    </div>
  )
}
