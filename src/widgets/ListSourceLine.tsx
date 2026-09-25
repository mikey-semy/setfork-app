import { Download, Lock } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { safeHref } from '@/shared/lib/safe-url'
import { canBePublic } from '@/core/domain/skill-license'

/** «Откуда импортирован»: `github.com/owner/repo/папка` без коммита — его несёт ссылка. */
function sourceLabel(url: string): string {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/tree\/[0-9a-f]+(?:\/(.*))?$/.exec(url)
  return m ? `${m[1]}${m[2] ? `/${m[2]}` : ''}` : url.replace(/^https?:\/\//, '')
}

/** Строка под названием импортированного скилла: источник, лицензия, запрет на публичность. */
export function ListSourceLine({
  meta,
  lang,
}: {
  meta: { sourceUrl: string | null; sourceLicense: string | null; sourceLicenseOpen: boolean | null }
  lang: Lang
}) {
  const href = meta.sourceUrl ? safeHref(meta.sourceUrl) : null
  if (!href) return null
  return (
    <p className="order-3 flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-ink-2 sm:order-last">
      <Download size={12} className="shrink-0" aria-hidden />
      <span>{t('importedFrom', lang)}</span>
      <a href={href} rel="noopener noreferrer nofollow" target="_blank" className="min-w-0 truncate text-accent hover:underline">
        {sourceLabel(meta.sourceUrl!)}
      </a>
      <span>
        ·{' '}
        {meta.sourceLicense === 'unknown'
          ? t('importUnknownLicense', lang)
          : meta.sourceLicense
            ? t('importLicense', lang).replace('{license}', meta.sourceLicense)
            : t('importNoLicense', lang)}
      </span>
      {!canBePublic(meta) ? (
        <span className="inline-flex items-center gap-1 text-warn">
          <Lock size={11} aria-hidden /> {t('importPrivateOnly', lang)}
        </span>
      ) : null}
    </p>
  )
}
