import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PAGE } from '@/shared/ui/control'

export default async function NotFound() {
  const lang = await getLang()
  return (
    <div className={`${PAGE} flex flex-1 flex-col items-center justify-center gap-4 text-center`}>
      <FileQuestion size={44} strokeWidth={1.5} className="text-muted" />
      <div className="font-mono text-[0.8125rem] text-muted">404</div>
      <h1 className="text-[1.25rem] font-bold text-ink">{t('pageNotFound', lang)}</h1>
      <p className="text-[0.875rem] text-ink-2">{t('pageNotFoundText', lang)}</p>
      <div className="mt-2 flex gap-3">
        <Link
          href="/"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-3 text-[0.78125rem] font-semibold text-ink hover:border-border-strong"
        >
          {t('goHome', lang)}
        </Link>
        <Link
          href="/explore"
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-[0.78125rem] font-semibold text-primary-fg hover:opacity-90"
        >
          {t('goExplore', lang)}
        </Link>
      </div>
    </div>
  )
}
