import 'server-only'
import type { CORSRule } from '@aws-sdk/client-s3'
import { isS3Configured } from '@/shared/settings/media'
import { getUploadsCors, presignPost, putUploadsCors } from './s3'

/**
 * CORS бакета прямых загрузок: браузер шлёт файл POST'ом прямо в бакет, и без
 * разрешающего правила предзапрос OPTIONS падает, а клиент видит только «пропала
 * связь» (браузер прячет причину). Настроить и проверить — из админки.
 */

/** Своё правило узнаём по ID: переустановка заменяет его, чужие правила бакета целы. */
export const UPLOADS_CORS_RULE_ID = 'setfork-direct-upload'

export function uploadsCorsRule(origin: string): CORSRule {
  return {
    ID: UPLOADS_CORS_RULE_ID,
    AllowedOrigins: [origin],
    AllowedMethods: ['POST'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'],
    // Сколько браузер помнит разрешение предзапроса: 50 минут — обычное значение у
    // AWS-примеров; меньше — лишний OPTIONS на каждый файл, больше браузеры режут сами.
    MaxAgeSeconds: 3000,
  }
}

/** Чужие правила — как были, своё (по ID) — заменить свежим. */
export function mergeCorsRules(existing: CORSRule[], rule: CORSRule): CORSRule[] {
  return [...existing.filter((r) => r.ID !== rule.ID), rule]
}

export type CorsSetupResult = { ok: true; rules: number } | { ok: false; reason: 'storage_unavailable' | 'failed'; detail?: string }

export async function setupUploadsCors(origin: string): Promise<CorsSetupResult> {
  if (!(await isS3Configured())) return { ok: false, reason: 'storage_unavailable' }
  try {
    const rules = mergeCorsRules(await getUploadsCors(), uploadsCorsRule(origin))
    await putUploadsCors(rules)
    return { ok: true, rules: rules.length }
  } catch (e) {
    return { ok: false, reason: 'failed', detail: e instanceof Error ? e.message : String(e) }
  }
}

export type CorsCheckResult =
  | { ok: true }
  | { ok: false; reason: 'storage_unavailable' | 'tls' | 'network' | 'status' | 'no_allow_origin'; status?: number; detail?: string }

/** Коды TLS-сбоев Node (undici кладёт их в `cause.code`). Имя бакета с точкой под
 *  виртуальным хостом даёт ровно такой: сертификат `*.s3…` его не покрывает. */
const TLS_CODES = /^(ERR_TLS_|CERT_|UNABLE_TO_VERIFY|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_GET_ISSUER)/

function errorCode(e: unknown): string {
  const cause = (e as { cause?: { code?: unknown } })?.cause
  const code = cause?.code ?? (e as { code?: unknown })?.code
  return typeof code === 'string' ? code : ''
}

/**
 * Предзапрос, какой сделал бы браузер перед загрузкой: OPTIONS на тот же адрес, что
 * отдаёт `presignPost`, с Origin сайта. Ответ разбирается в человеческую причину.
 */
export async function checkUploadsCors(origin: string): Promise<CorsCheckResult> {
  if (!(await isS3Configured())) return { ok: false, reason: 'storage_unavailable' }
  let res: Response
  try {
    const { url } = await presignPost('cors-check', 'application/octet-stream', 1, 60)
    res = await fetch(url, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e) {
    const code = errorCode(e)
    if (TLS_CODES.test(code)) return { ok: false, reason: 'tls', detail: code }
    return { ok: false, reason: 'network', detail: code || (e instanceof Error ? e.message : String(e)) }
  }
  if (!res.ok) return { ok: false, reason: 'status', status: res.status }
  const allow = res.headers.get('access-control-allow-origin')
  if (allow !== origin && allow !== '*') return { ok: false, reason: 'no_allow_origin', status: res.status }
  return { ok: true }
}
