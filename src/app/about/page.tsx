import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PageHeader } from '@/shared/ui/PageHeader'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('aboutProject', lang) }
}

export default async function AboutPage() {
  const lang = await getLang()
  return (
    <div className="mx-auto w-full max-w-[42.5rem] px-6 py-12">
      <PageHeader title={t('aboutProject', lang)} />
      <p className="text-[0.875rem] leading-relaxed text-ink-2">{t('aboutBody', lang)}</p>
    </div>
  )
}
