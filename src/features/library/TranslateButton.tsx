'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Languages, Loader2 } from 'lucide-react'
import { LANG_META, t, type Lang } from '@/shared/i18n'
import { translateList } from './actions'

// Кнопка «Перевести» (ADR-0009): AI-перевод полей списка на язык зрителя,
// ДОБАВЛЯЕТ языковой ключ (оригинал остаётся) → новая версия. Видна владельцу/
// коллаборатору, когда перевода на язык зрителя ещё нет. Тон нейтральный —
// гномья душа живёт в «театре процесса», не в кнопке (см. концепт совета гномов).
export function TranslateButton({ templateId, targetLang, lang }: { templateId: string; targetLang: Lang; lang: Lang }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState('')

  function run() {
    setErr('')
    start(async () => {
      const res = await translateList(templateId, targetLang)
      if ('error' in res) setErr(t('translateFailed', lang))
      else router.refresh()
    })
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title={t('translateInto', lang).replace('{lang}', LANG_META[targetLang].endonym)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-semibold text-ink hover:border-border-strong disabled:opacity-60"
      >
        {pending ? <Loader2 size={13} className="animate-spin" /> : <Languages size={13} />}
        <span className="hidden md:inline">
          {pending ? t('translating', lang) : t('translateInto', lang).replace('{lang}', LANG_META[targetLang].endonym)}
        </span>
      </button>
      {err && <span className="mt-0.5 text-[11px] text-danger">{err}</span>}
    </span>
  )
}
