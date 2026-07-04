'use client'

import { useEffect, useState } from 'react'
import { RotateCw, TriangleAlert } from 'lucide-react'
import { DEFAULT_LANG, isLang, t, type Lang } from '@/shared/i18n'
import { captureError } from '@/shared/observability'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [lang, setLang] = useState<Lang>(DEFAULT_LANG)
  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )lang=([^;]+)/)
    if (m && isLang(m[1])) setLang(m[1])
  }, [])
  useEffect(() => {
    captureError(error, { where: 'app/error', digest: error.digest })
  }, [error])

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <TriangleAlert size={44} strokeWidth={1.5} className="text-danger" />
      <h1 className="text-[20px] font-bold text-ink">{t('somethingWrong', lang)}</h1>
      <p className="text-[14px] text-ink-2">{t('somethingWrongText', lang)}</p>
      <button
        onClick={reset}
        className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg"
      >
        <RotateCw size={14} /> {t('tryAgain', lang)}
      </button>
    </div>
  )
}
