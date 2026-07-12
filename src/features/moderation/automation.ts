// Чистая логика автоматической верификации: спам-эвристики (0 токенов),
// отпечаток контента (ловля повторной заливки удалённого), маршрутизация
// вердикта классификатора по порогам уверенности. Без БД — покрыто юнит-тестами.
import { createHash } from 'node:crypto'
import { hostMatches } from '@/core'
import type { ModerationVerdict } from '@/shared/ai/moderate'

// Пороги маршрутизации (T&S-паттерн: уверенное решает автомат, серая зона — человек).
export const APPROVE_CONFIDENCE = 0.7 // safe и уверен → active
export const FLAG_CONFIDENCE = 0.8 // unsafe и уверен → flagged без человека
// Тяжёлые категории MLCommons — наверх очереди.
const SEVERE_CATEGORIES = ['S1', 'S3', 'S4', 'S9']

const URL_SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy', 'shorturl.at', 'ow.ly', 'buff.ly',
])
const MAX_DISTINCT_HOSTS = 10

export interface ListSignals {
  title: string
  stepCount: number
  text: string // полный текст (для LLM и извлечения ссылок)
}

export function extractHosts(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/https?:\/\/([^\s/)"'<>]+)/gi)) {
    // хвостовая пунктуация («…bit.ly, потом…») — не часть хоста
    const host = m[1].toLowerCase().replace(/^www\./, '').replace(/[.,;:!?'\]]+$/, '')
    if (host) out.add(host)
  }
  return [...out]
}

/** Дешёвые эвристики до ИИ. Ловим только очевидное — сомнительное уходит классификатору.
 *  allowedHosts — домены-магазины из партнёрских правил админки: корзина
 *  («Shop this list») легально даёт много хостов, доверенные НЕ считаем в
 *  link-farm (шортенеры проверяются по полному набору — им скидки нет). */
export function checkSpamHeuristics(s: ListSignals, allowedHosts: string[] = []): { spam: boolean; reason: string } {
  if (s.stepCount === 0) return { spam: true, reason: 'spam heuristic: empty list (no steps)' }
  if (s.title.trim().length < 3) return { spam: true, reason: 'spam heuristic: no meaningful title' }
  const hosts = extractHosts(s.text)
  const short = hosts.find((h) => URL_SHORTENERS.has(h))
  if (short) return { spam: true, reason: `spam heuristic: url shortener (${short})` }
  const counted = hosts.filter((h) => !allowedHosts.some((a) => hostMatches(h, a)))
  if (counted.length > MAX_DISTINCT_HOSTS)
    return { spam: true, reason: `spam heuristic: link farm (${counted.length} distinct hosts)` }
  return { spam: false, reason: '' }
}

// Минимальная длина нормализованного тела: короче — отпечаток вырожден
// (пустой/односложный контент на любом алфавите схлопнулся бы в один хэш).
export const MIN_FINGERPRINT_BODY = 20

/** Нормализованное тело контента (для отпечатка): без регистра/пунктуации/пробелов,
 *  любой алфавит (\p{L}), чтобы CJK/арабский не вырождались в пустую строку. */
export function fingerprintBody(title: string, stepTitles: string[]): string {
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  return [norm(title), ...stepTitles.map(norm)].filter(Boolean).join('|')
}

/** Отпечаток контента: одинаковая суть → одинаковый хэш,
 *  косметические правки (регистр/пунктуация/пробелы) его не меняют. */
export function contentFingerprint(title: string, stepTitles: string[]): string {
  return createHash('sha256').update(fingerprintBody(title, stepTitles)).digest('hex')
}

export type GateAction =
  | { action: 'approve' } // виден всем
  | { action: 'flag'; severity: number; reason: string } // в очередь админа (не публичен)
  | { action: 'hold'; severity: number; reason: string } // остаётся pending — нужен человек
  | { action: 'none' } // пере-проверка видимого: нарушений нет, ничего не делаем

export function categorySeverity(category: string): number {
  const code = category.trim().split(/\s+/)[0].toUpperCase()
  return SEVERE_CATEGORIES.includes(code) ? 3 : 2
}

/**
 * Маршрутизация вердикта. gate=true — решаем судьбу pending-списка;
 * gate=false — фоновая пере-проверка видимого (снимаем с публикации только
 * при уверенном нарушении — неуверенность не повод для takedown живого списка).
 */
export function routeVerdict(v: ModerationVerdict, gate: boolean): GateAction {
  if (v.flagged && v.confidence >= FLAG_CONFIDENCE)
    return { action: 'flag', severity: categorySeverity(v.category), reason: `AI [${v.category || '—'}]: ${v.reason}` }
  if (!gate) return { action: 'none' }
  if (!v.flagged && v.confidence >= APPROVE_CONFIDENCE) return { action: 'approve' }
  const pct = Math.round(v.confidence * 100)
  return {
    action: 'hold',
    severity: 1,
    reason: `AI uncertain (${pct}%${v.category ? `, ${v.category}` : ''}): ${v.reason} — needs human review`,
  }
}
