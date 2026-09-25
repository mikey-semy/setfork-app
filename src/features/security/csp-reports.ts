import 'server-only'
import { createHash } from 'node:crypto'
import { count, eq, sql } from 'drizzle-orm'
import { db, cspReports } from '@/shared/db'

/**
 * ОТЧЁТЫ О НАРУШЕНИЯХ CSP: разбор двух форматов браузеров и запись в сводку.
 *
 * Форматов два, и оба живы:
 *  • `report-uri` (CSP2) — `application/csp-report`, тело `{"csp-report": {…}}` с полями
 *    через дефис; так шлют Firefox и Safari;
 *  • Reporting API (`report-to`) — `application/reports+json`, МАССИВ
 *    `[{type: "csp-violation", body: {…}}]` с полями в camelCase; так шлёт Chromium.
 * Разбираем по ФОРМЕ тела, а не по Content-Type: его подставляет браузер, и полагаться
 * на точное совпадение значит молча терять отчёты от того, кто написал его иначе.
 *
 * Тело присылает кто угодно — эндпоинт открыт, иначе браузер не смог бы отчитаться.
 * Поэтому каждое поле проверяется и режется, а число разных строк сводки ограничено.
 */

/** Один отчёт после нормализации — ровно то, что пишется в сводку. */
export type CspViolation = {
  directive: string
  blocked: string
  source: string
  path: string
  line: number | null
}

/** Отчётов в одном теле. Chromium копит их пачкой, но десятки за раз — уже не браузер. */
export const MAX_REPORTS_PER_BODY = 20

/**
 * ⚠️ Потолок РАЗНЫХ строк сводки. Нарушений у сайта — единицы видов; сотни значат, что
 * кто-то сочиняет отчёты. Дойдя до потолка, сводка продолжает считать уже известные виды,
 * а новые молча пропускает: за неделю наблюдения важны частые нарушения, а редкие
 * выдуманные — нет.
 */
export const MAX_DISTINCT = 1000

/** Ключевые слова вместо адреса, которые пишет браузер (CSP3, «violation resource»). */
const KEYWORDS = new Set(['inline', 'eval', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink'])

const FIELD_MAX = 500

/**
 * Адрес — без query и фрагмента: в них бывают токены и одноразовые ссылки, а для
 * сводки важно, ЧТО заблокировано, а не с какими параметрами.
 * `null` — отчёт выбросить: нарушение внутри расширения браузера — не наш скрипт.
 */
function cleanUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '') return ''
  if (KEYWORDS.has(raw)) return raw
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return ''
  }
  if (url.protocol.endsWith('-extension:')) return null
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return url.protocol.slice(0, -1)
  return (url.origin + url.pathname).slice(0, FIELD_MAX)
}

function pathOf(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  try {
    return new URL(raw).pathname.slice(0, FIELD_MAX)
  } catch {
    return ''
  }
}

/** `script-src-elem`, а не `script-src-elem 'nonce-…' …`: старый формат шлёт директиву целиком. */
function directiveOf(effective: unknown, violated: unknown): string | null {
  const raw = typeof effective === 'string' && effective ? effective : typeof violated === 'string' ? violated : ''
  const name = raw.split(' ')[0]
  return /^[a-z-]{1,40}$/.test(name) ? name : null
}

function one(f: Record<string, unknown>, camel: boolean): CspViolation | null {
  const pick = (a: string, b: string) => f[camel ? a : b]
  const directive = directiveOf(pick('effectiveDirective', 'effective-directive'), pick('violatedDirective', 'violated-directive'))
  const blocked = cleanUrl(pick('blockedURL', 'blocked-uri'))
  const source = cleanUrl(pick('sourceFile', 'source-file'))
  if (!directive || blocked === null || source === null) return null
  const n = Number(pick('lineNumber', 'line-number'))
  return {
    directive,
    blocked,
    source,
    path: pathOf(pick('documentURL', 'document-uri')),
    line: Number.isInteger(n) && n > 0 ? n : null,
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Разобрать тело запроса. Непонятное — пустой список, а не ошибка: браузеру ответ не нужен. */
export function parseCspReports(body: unknown): CspViolation[] {
  const raw: Array<CspViolation | null> = []
  if (isObj(body) && isObj(body['csp-report'])) raw.push(one(body['csp-report'], false))
  else if (Array.isArray(body)) {
    for (const r of body.slice(0, MAX_REPORTS_PER_BODY)) {
      if (isObj(r) && r.type === 'csp-violation' && isObj(r.body)) raw.push(one(r.body, true))
    }
  }
  return raw.filter((v): v is CspViolation => v !== null)
}

const keyOf = (v: CspViolation) => createHash('sha256').update(`${v.directive}\n${v.blocked}\n${v.source}`).digest('hex')

/**
 * Учесть нарушение: известный вид — счётчик и свежий пример, новый — строка, пока
 * сводка не упёрлась в потолок. Ниже потолка это одна вставка с `ON CONFLICT`: повтор
 * вида и гонка двух одинаковых первых отчётов сходятся в ней же. На потолке — только
 * UPDATE, новых строк нет. Потолок мягкий: гонка у самой границы может перешагнуть его
 * на единицы строк, и это не важно — он от наводнения, а не для точного счёта.
 */
export async function recordCspViolation(v: CspViolation): Promise<void> {
  const key = keyOf(v)
  const bump = { count: sql`${cspReports.count} + 1`, lastSeen: new Date(), samplePath: v.path, sampleLine: v.line }
  const [{ n }] = await db.select({ n: count() }).from(cspReports)
  if (n >= MAX_DISTINCT) {
    await db.update(cspReports).set(bump).where(eq(cspReports.key, key))
    return
  }
  await db
    .insert(cspReports)
    .values({ key, directive: v.directive, blocked: v.blocked, source: v.source, samplePath: v.path, sampleLine: v.line })
    .onConflictDoUpdate({ target: cspReports.key, set: bump })
}
