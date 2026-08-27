import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PAGE } from '@/shared/ui/control'
import { buttonClass } from '@/shared/ui/button-style'

export default async function NotFound() {
  const lang = await getLang()
  return (
    <div className={`${PAGE} flex flex-1 flex-col items-center justify-center gap-4 text-center`}>
      <FileQuestion size={44} strokeWidth={1.5} className="text-muted" />
      <div className="font-mono text-body text-muted">404</div>
      <h1 className="text-heading font-bold text-ink">{t('pageNotFound', lang)}</h1>
      <p className="text-body-lg text-ink-2">{t('pageNotFoundText', lang)}</p>
      <div className="mt-2 flex gap-3">
        <Link
          href="/"
          className={buttonClass()}
        >
          {t('goHome', lang)}
        </Link>
        <Link
          href="/explore"
          className={buttonClass({ variant: 'primary' })}
        >
          {t('goExplore', lang)}
        </Link>
      </div>
    </div>
  )
}
