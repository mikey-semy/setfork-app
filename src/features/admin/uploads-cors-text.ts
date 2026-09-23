import { fill, t, type Lang } from '@/shared/i18n'
import type { CorsCheckResult, CorsSetupResult } from '@/shared/media/uploads-cors'

export type Outcome = { ok: boolean; text: string }

/** Итог проверки CORS — по-человечески, с причиной. Чистая функция: её и тестируем. */
export function corsCheckText(r: CorsCheckResult & { origin: string }, lang: Lang): Outcome {
  if (r.ok) return { ok: true, text: fill('admin.uploadsCors.checkOk', lang, { origin: r.origin }) }
  switch (r.reason) {
    case 'storage_unavailable':
      return { ok: false, text: t('upload.error.storage_unavailable', lang) }
    case 'tls':
      return { ok: false, text: fill('admin.uploadsCors.checkTls', lang, { code: r.detail ?? '' }) }
    case 'status':
      return { ok: false, text: fill('admin.uploadsCors.checkStatus', lang, { status: r.status ?? 0 }) }
    case 'no_allow_origin':
      return { ok: false, text: fill('admin.uploadsCors.checkNoAllow', lang, { origin: r.origin }) }
    default:
      return { ok: false, text: fill('admin.uploadsCors.checkNetwork', lang, { detail: r.detail ?? '' }) }
  }
}

export function corsSetupText(r: CorsSetupResult, lang: Lang): Outcome {
  if (r.ok) return { ok: true, text: fill('admin.uploadsCors.setupOk', lang, { n: r.rules }) }
  if (r.reason === 'storage_unavailable') return { ok: false, text: t('upload.error.storage_unavailable', lang) }
  return { ok: false, text: fill('admin.uploadsCors.setupFailed', lang, { detail: r.detail ?? '' }) }
}

