'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Languages, Loader2 } from 'lucide-react'
import { LANG_META, t, type Lang } from '@/shared/i18n'
import { Tooltip } from '@/shared/ui/Tooltip'
import { toast } from '@/shared/ui/toast'
import { translateList } from './actions/ai'
import { buttonClass } from '@/shared/ui/button-style'

// Кнопка «Перевести» (ADR-0009): AI-перевод полей списка на язык зрителя, ДОБАВЛЯЕТ
// языковой ключ (оригинал остаётся) → новая версия. Икон-онли (как x.com), подпись —
// в тултипе; ошибку показываем тостом, а не инлайн-красным. Тон нейтральный.
export function TranslateButton({ templateId, targetLang, lang, iconOnly }: { templateId: string; targetLang: Lang; lang: Lang; iconOnly?: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const label = t('translateInto', lang).replace('{lang}', LANG_META[targetLang].endonym)

  // Конкретная причина в тост (а не только «не удалось»): что именно случилось.
  const reason = (code: string): string => {
    if (code === 'ratelimited') return t('rateLimited', lang)
    if (code === 'ai_quota') return t('library.monthlyLimitReachedTry', lang)
    return t('translateFailed', lang) // aifail / mismatch / прочее
  }

  function run() {
    start(async () => {
      const res = await translateList(templateId, targetLang)
      if ('error' in res) toast.error(reason(res.error))
      else router.refresh()
    })
  }

  return (
    <Tooltip label={pending ? t('translating', lang) : label}>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        aria-label={label}
        className={
          iconOnly
            ? buttonClass({ variant: 'ghost', size: 'sm', className: 'size-7 shrink-0 p-0 text-muted' })
            : buttonClass({ className: 'size-8 shrink-0 p-0' })
        }
      >
        {pending ? <Loader2 size={15} className="animate-spin" /> : <Languages size={15} />}
      </button>
    </Tooltip>
  )
}
