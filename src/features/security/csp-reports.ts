import 'server-only'
import { createHash } from 'node:crypto'
import { count, eq, sql } from 'drizzle-orm'
import { db, cspReports } from '@/shared/db'

/**
 * ОТЧЁТЫ О НАРУШЕНИЯХ CSP: разбор двух форматов браузеров и запись в сводку.
 *
 * Форматов два:
 *  • `report-uri` (CSP2) — `application/csp-report`, тело `{"csp-report": {…}}` с полями
 *    через дефис. Наша политика объявляет только его, и на него так шлют ВСЕ браузеры,
 *    включая Chromium (проверено живым прогоном);
 *  • Reporting API (`report-to`) — `application/reports+json`, МАССИВ
 *    `[{type: "csp-violation", body: {…}}]` с полями в camelCase. Сейчас его шлёт
 *    только поддельный отправитель; разбор — задел на случай, если `report-to` вернут.
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

/** Метка вместо адреса страницы нашего сайта — для нарушений внутри самого документа. */
export const DOCUMENT = 'document'

/**
 * Путь нашей страницы — только первый сегмент (с языковым префиксом), остальное `*`:
 * `/miki/tajnyj-spisok` → `/miki/*`. Для сводки довольно знать, КАКАЯ это страница,
 * а слаг приватного списка — его название транслитом, и хранить его незачем.
 */
function maskPath(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean)
  const keep = parts[0] === 'ru' || parts[0] === 'en' ? 2 : 1
  const masked = parts.map((p, i) => (i < keep ? p : '*'))
  return ('/' + masked.join('/')).slice(0, FIELD_MAX)
}

function parseUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw === '') return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/**
 * Адрес — без query и фрагмента: в них бывают токены и одноразовые ссылки, а для
 * сводки важно, ЧТО заблокировано, а не с какими параметрами.
 *
 * ⚠️ Адрес НАШЕГО сайта вне `/_next/` сводится к метке `document`. Для нарушения во
 * встроенном скрипте браузер называет источником адрес самой страницы (проверено
 * живым прогоном в Chromium), и без этого одно нарушение давало строку на КАЖДУЮ
 * страницу: сводка забивалась обычным трафиком, а в ней оседали ники и слаги.
 * Чанки `/_next/` — наш код, их путь как раз нужен.
 *
 * `null` — отчёт выбросить: нарушение внутри расширения браузера — не наш скрипт.
 */
function cleanUrl(raw: unknown, own: string | null): string | null {
  if (typeof raw === 'string' && KEYWORDS.has(raw)) return raw
  const url = parseUrl(raw)
  if (!url) return ''
  if (url.protocol.endsWith('-extension:')) return null
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return url.protocol.slice(0, -1)
  if (url.origin === own && !url.pathname.startsWith('/_next/')) return DOCUMENT
  return (url.origin + url.pathname).slice(0, FIELD_MAX)
}

/** `script-src-elem`, а не `script-src-elem 'nonce-…' …`: старый формат шлёт директиву целиком. */
function directiveOf(effective: unknown, violated: unknown): string | null {
  const raw = typeof effective === 'string' && effective ? effective : typeof violated === 'string' ? violated : ''
  const name = raw.split(' ')[0]
  return /^[a-z-]{1,40}$/.test(name) ? name : null
}

function one(f: Record<string, unknown>, camel: boolean): CspViolation | null {
  const pick = (a: string, b: string) => f[camel ? a : b]
  const doc = parseUrl(pick('documentURL', 'document-uri'))
  const own = doc?.origin ?? null
  const directive = directiveOf(pick('effectiveDirective', 'effective-directive'), pick('violatedDirective', 'violated-directive'))
  const blocked = cleanUrl(pick('blockedURL', 'blocked-uri'), own)
  const source = cleanUrl(pick('sourceFile', 'source-file'), own)
  if (!directive || blocked === null || source === null) return null
  const n = Number(pick('lineNumber', 'line-number'))
  return {
    directive,
    blocked,
    source,
    path: doc ? maskPath(doc.pathname) : '',
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

/** Потолок сводки достигнут — предупреждение в журнал одно на процесс, а не на отчёт. */
let warnedFull = false

/**
 * Учесть нарушение. Известный вид — один UPDATE (это основной поток: повторы одного
 * нарушения). Новый — строка, если сводка ниже потолка и `mayAdd` разрешает (лимит
 * новых видов на отправителя, решает приёмник); вставка с `ON CONFLICT` сводит гонку
 * двух одинаковых первых отчётов. Потолок мягкий: гонка у границы может перешагнуть
 * его на единицы строк — он от наводнения, а не для точного счёта.
 *
 * ⚠️ Упор в потолок — предупреждение в журнал: иначе неделя «без новых нарушений»
 * значила бы «сводка полна», и решение о боевом заголовке принималось бы вслепую.
 */
export async function recordCspViolation(v: CspViolation, mayAdd: () => Promise<boolean> = async () => true): Promise<void> {
  const key = keyOf(v)
  const hit = await db.update(cspReports).set(bump(v)).where(eq(cspReports.key, key)).returning({ key: cspReports.key })
  if (hit.length > 0) return
  const [{ n }] = await db.select({ n: count() }).from(cspReports)
  if (n >= MAX_DISTINCT) {
    if (!warnedFull) console.warn(`[csp] сводка нарушений на потолке ${MAX_DISTINCT} видов — новые виды не пишутся`)
    warnedFull = true
    return
  }
  if (!(await mayAdd())) return
  await insertCspKind(v)
}

const bump = (v: CspViolation) => ({ count: sql`${cspReports.count} + 1`, lastSeen: new Date(), samplePath: v.path, sampleLine: v.line })

/** Вставить вид; уже есть (гонка) — посчитать как повтор. Отдельно — чтобы проверить ветку конфликта. */
export async function insertCspKind(v: CspViolation): Promise<void> {
  await db
    .insert(cspReports)
    .values({ key: keyOf(v), directive: v.directive, blocked: v.blocked, source: v.source, samplePath: v.path, sampleLine: v.line })
    .onConflictDoUpdate({ target: cspReports.key, set: bump(v) })
}
