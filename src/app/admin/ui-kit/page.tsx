import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { UiKitGallery } from '@/features/admin/UiKitGallery'
import { t } from '@/shared/i18n'

export const metadata = { title: 'UI Kit' }

/** Эталон интерфейса: все примитивы shared/ui в одном месте, размеры и состояния
 *  рядом — расхождения видны глазами до того, как расползутся по страницам.
 *  Правило: новый примитив/вариант/размер сначала появляется здесь. */
export default async function AdminUiKitPage() {
  await requireAdmin()
  const lang = await getLang()
  return (
    <div className="min-w-0">
      <h1 className="mb-1 text-[1rem] font-bold text-ink">UI Kit</h1>
      <p className="mb-5 text-[0.8125rem] text-ink-2">
        {t('admin.referenceSharedUiPrimitives', lang)}
      </p>
      <UiKitGallery lang={lang} />
    </div>
  )
}
