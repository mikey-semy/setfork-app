import { Megaphone } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { imageUrl } from '@/shared/media'
import { getLandingContent } from '@/shared/settings/landing'
import { PageHeader } from '@/shared/ui/PageHeader'
import { LandingEditor } from '@/features/admin/LandingEditor'

export const metadata = { title: 'Landing' }

// Редактор маркетинг-лендинга (setfork-about): тексты (лимиты + AI-подсказки),
// плитки-статы, картинка hero (DnD). Лендинг подхватывает через ISR /api/landing.
export default async function AdminLandingPage() {
  await requireAdmin()
  const lang = await getLang()
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en)
  const content = await getLandingContent()
  const heroPreview = content.heroImage ? ((await imageUrl(content.heroImage, 'rs:fit:640:0')) ?? undefined) : undefined

  return (
    <div className="mx-auto w-full max-w-[860px] px-6 py-8">
      <PageHeader
        icon={<Megaphone size={18} />}
        title={say('Landing', 'Лендинг')}
        subtitle={say('Editable copy, stats and hero image of the marketing landing. Live via /api/landing (ISR).', 'Тексты, статы и картинка hero маркетинг-лендинга. Публикуется по /api/landing (ISR).')}
      />
      <LandingEditor initial={content} heroPreview={heroPreview} lang={lang} />
    </div>
  )
}
