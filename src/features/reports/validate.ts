// Чистая валидация жалобы на контент — без next/БД, покрывается unit-тестами.

export const REPORT_REASONS = ['illegal', 'spam', 'copyright', 'privacy', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

export const REPORT_BODY_MIN = 10
export const REPORT_BODY_MAX = 2000
export const REPORT_EMAIL_MAX = 200

export type ReportRaw = {
  templateId?: unknown
  reason?: unknown
  body?: unknown
  email?: unknown
  /** Honeypot: скрытое поле, люди его не заполняют. Непустое = бот. */
  website?: unknown
}

export type ReportParsed =
  | { ok: true; templateId: string; reason: ReportReason; body: string; email: string }
  | { ok: false; error: 'spam' | 'bad_template' | 'bad_reason' | 'body_short' | 'body_long' | 'bad_email' }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function parseReport(raw: ReportRaw): ReportParsed {
  if (asString(raw.website).trim()) return { ok: false, error: 'spam' }

  const templateId = asString(raw.templateId).trim()
  if (!UUID_RE.test(templateId)) return { ok: false, error: 'bad_template' }

  // В отличие от фидбека, причину не фолбэчим в other: жалоба с неверной
  // причиной — сломанная форма или бот, молча подменять смысл нельзя.
  const reason = asString(raw.reason)
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) return { ok: false, error: 'bad_reason' }

  const body = asString(raw.body).replace(/\r\n/g, '\n').trim()
  if (body.length < REPORT_BODY_MIN) return { ok: false, error: 'body_short' }
  if (body.length > REPORT_BODY_MAX) return { ok: false, error: 'body_long' }

  const email = asString(raw.email).trim()
  if (email && (email.length > REPORT_EMAIL_MAX || !EMAIL_RE.test(email))) {
    return { ok: false, error: 'bad_email' }
  }

  return { ok: true, templateId, reason: reason as ReportReason, body, email }
}
