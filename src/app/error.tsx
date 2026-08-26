'use client'

// Ошибки роутов НИЖЕ корневого layout (стили/темы доступны). Краш самого
// корневого layout ловит app/global-error.tsx.
import { useEffect, useState } from 'react'
import { RotateCw, TriangleAlert } from 'lucide-react'
import { DEFAULT_LANG, isLang, t, type Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { captureError } from '@/shared/observability'
import { PAGE } from '@/shared/ui/control'

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [lang, setLang] = useState<Lang>(DEFAULT_LANG)
  useEffect(() => {
    // <html lang> — ровно то, что решил сервер (cookie → Accept-Language), и
    // корневой layout при ошибке ниже него ЖИВ. Cookie одной было мало: без
    // ручного переключения языка её нет, и русские видели английскую ошибку.
    const fromHtml = document.documentElement.lang
    if (isLang(fromHtml)) return setLang(fromHtml)
    const m = document.cookie.match(/(?:^|; )lang=([^;]+)/)
    if (m && isLang(m[1])) return setLang(m[1])
    const fromNav = navigator.language?.slice(0, 2).toLowerCase()
    if (isLang(fromNav)) setLang(fromNav)
  }, [])
  useEffect(() => {
    captureError(error, { where: 'app/error', digest: error.digest })
  }, [error])

  return (
    <div className={`${PAGE} flex flex-1 flex-col items-center justify-center gap-4 text-center`}>
      <TriangleAlert size={44} strokeWidth={1.5} className="text-danger" />
      <h1 className="text-heading font-bold text-ink">{t('somethingWrong', lang)}</h1>
      <p className="text-body-lg text-ink-2">
        {t('somethingWrongText', lang)}
        <br />
        {t('somethingWrongHint', lang)}
      </p>
      <Button variant="primary" size="md" onClick={reset} className="mt-2">
        <RotateCw size={14} /> {t('tryAgain', lang)}
      </Button>
    </div>
  )
}
