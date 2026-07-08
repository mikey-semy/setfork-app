import { createHash } from 'node:crypto'

// Идентификация посетителя для трафик-аналитики — чистые функции (покрыты тестами).
// Приватность: анонимов не куки́руем; хеш ip|ua ротируется ежедневно, так что
// кросс-дневного трекинга нет и PII в БД не попадает.

const BOT_RE = /bot|crawl|spider|slurp|curl|wget|python-requests|headless|lighthouse|facebookexternalhit|bingpreview|preview/i

/** Грубая отсечка ботов по User-Agent (пустой UA тоже считаем ботом). */
export function isBot(userAgent: string | null | undefined): boolean {
  return !userAgent || BOT_RE.test(userAgent)
}

/** День в UTC (YYYY-MM-DD) — граница дедупа просмотров и ротации анонимного хеша. */
export function dayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** Ключ посетителя: вошедший — стабильный 'u:<id>', аноним — 'a:<sha256(ip|ua|день|секрет)>'. */
export function visitorKey(userId: string | null | undefined, ip: string, userAgent: string | null, day = dayUtc()): string {
  if (userId) return `u:${userId}`
  const secret = process.env.AUTH_SECRET ?? ''
  const h = createHash('sha256').update(`${ip}|${userAgent ?? ''}|${day}|${secret}`).digest('hex')
  return `a:${h.slice(0, 32)}`
}
