import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { UiKitGallery } from '@/features/admin/UiKitGallery'

export const metadata = { title: 'UI Kit' }

/** Эталон интерфейса: все примитивы shared/ui в одном месте, размеры и состояния
 *  рядом — расхождения видны глазами до того, как расползутся по страницам.
 *  Правило: новый примитив/вариант/размер сначала появляется здесь. */
export default async function AdminUiKitPage() {
  await requireAdmin()
  const lang = await getLang()
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  return (
    <div className="mx-auto w-full max-w-[860px] px-4 py-6">
      <h1 className="mb-1 text-[16px] font-bold text-ink">UI Kit</h1>
      <p className="mb-5 text-[13px] text-ink-2">
        {say(
          'Reference for shared/ui primitives. Same-size controls in one row share one height and font; the scale lives in shared/ui/control.ts.',
          'Эталон примитивов shared/ui. Контролы одного размера в одном ряду — одна высота и один кегль; шкала — shared/ui/control.ts.',
        )}
      </p>
      <UiKitGallery lang={lang} />
    </div>
  )
}
