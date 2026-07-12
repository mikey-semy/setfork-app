// Чистая валидация/нормализация фидбека — без next/БД, покрывается unit-тестами.

export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'content', 'legal', 'other'] as const
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]

export const FEEDBACK_BODY_MIN = 10
export const FEEDBACK_BODY_MAX = 4000
export const FEEDBACK_EMAIL_MAX = 200
export const FEEDBACK_PAGE_URL_MAX = 500

export type FeedbackRaw = {
  category?: unknown
  body?: unknown
  email?: unknown
  pageUrl?: unknown
  /** Honeypot: скрытое поле, люди его не заполняют. Непустое = бот. */
  website?: unknown
}

export type FeedbackParsed =
  | { ok: true; category: FeedbackCategory; body: string; email: string; pageUrl: string }
  | { ok: false; error: 'spam' | 'body_short' | 'body_long' | 'bad_email' }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CONTROL_RE = /[\u0000-\u001f\u007f]/g

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function parseFeedback(raw: FeedbackRaw): FeedbackParsed {
  if (asString(raw.website).trim()) return { ok: false, error: 'spam' }

  const body = asString(raw.body).replace(/\r\n/g, '\n').trim()
  if (body.length < FEEDBACK_BODY_MIN) return { ok: false, error: 'body_short' }
  if (body.length > FEEDBACK_BODY_MAX) return { ok: false, error: 'body_long' }

  const email = asString(raw.email).trim()
  if (email && (email.length > FEEDBACK_EMAIL_MAX || !EMAIL_RE.test(email))) {
    return { ok: false, error: 'bad_email' }
  }

  const cat = asString(raw.category)
  const category: FeedbackCategory = (FEEDBACK_CATEGORIES as readonly string[]).includes(cat)
    ? (cat as FeedbackCategory)
    : 'other'

  // Откуда пришли — справочно; контролу не доверяем: режем управляющие символы и длину.
  const pageUrl = asString(raw.pageUrl).replace(CONTROL_RE, '').trim().slice(0, FEEDBACK_PAGE_URL_MAX)

  return { ok: true, category, body, email, pageUrl }
}
