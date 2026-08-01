import { Megaphone } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { imageUrl } from '@/shared/media'
import { getLandingContent } from '@/shared/settings/landing'
import { PageHeader } from '@/shared/ui/PageHeader'
import { LandingEditor } from '@/features/admin/LandingEditor'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('adminLanding', lang) }
}

// Редактор маркетинг-лендинга (setfork-about): тексты (лимиты + AI-подсказки),
// плитки-статы, картинка hero (DnD). Лендинг подхватывает через ISR /api/landing.
export default async function AdminLandingPage() {
  await requireAdmin()
  // Независимые запросы — параллельно (react-doctor).
  const [lang, content] = await Promise.all([getLang(), getLandingContent()])
  const heroPreview = content.heroImage ? ((await imageUrl(content.heroImage, 'rs:fit:640:0')) ?? undefined) : undefined

  return (
    <div className="mx-auto w-full max-w-[53.75rem] px-6 py-8">
      <PageHeader
        icon={<Megaphone size={18} />}
        title={t('admin.landing', lang)}
        subtitle={t('admin.editableCopyStatsHero', lang)}
      />
      <LandingEditor initial={content} heroPreview={heroPreview} lang={lang} />
    </div>
  )
}
