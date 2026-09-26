import { Megaphone } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { getLandingOverrides, LANDING_KEYS } from '@/shared/settings/landing'
import { PageHeader } from '@/shared/ui/PageHeader'
import { LandingEditor } from '@/features/admin/LandingEditor'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('adminLanding', lang) }
}

// Правки маркетинг-лендинга (setfork-about): строки словаря и полоса доверия с источниками.
// Лендинг подхватывает их через ISR /api/landing; пустое поле — работает его словарь.
export default async function AdminLandingPage() {
  await requireAdmin()
  const [lang, overrides] = await Promise.all([getLang(), getLandingOverrides()])

  return (
    <div className="min-w-0">
      <PageHeader icon={<Megaphone size={18} />} title={t('admin.landing', lang)} subtitle={t('admin.landingSubtitle', lang)} />
      <LandingEditor initial={overrides} keys={LANDING_KEYS} lang={lang} />
    </div>
  )
}
