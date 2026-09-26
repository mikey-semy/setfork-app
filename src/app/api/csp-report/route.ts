import { parseCspReports, recordCspViolation } from '@/features/security/csp-reports'
import { readBodyCapped } from '@/shared/http/read-body'
import { clientIp, rateLimit, tooMany } from '@/shared/rate-limit'

/**
 * Приёмник отчётов о нарушениях CSP (адрес — `CSP_REPORT_PATH` в shared/security/csp.ts).
 *
 * Открыт без входа и без проверки Origin: отчёт шлёт сам браузер, без кук, и у
 * `report-uri` заголовка Origin может не быть вовсе. Ответ — 204 (кроме лимита):
 * браузер его не читает, а подробности о том, что принято, отправителю ни к чему.
 */
export const runtime = 'nodejs'

/** Тело больше этого — не отчёт браузера: пачка из `MAX_REPORTS_PER_BODY` умещается с запасом. */
const MAX_BODY = 64 * 1024

/**
 * ОТЧЁТОВ (не запросов) с одного адреса в минуту. Браузер по `report-uri` шлёт один
 * отчёт на нарушение; человек, листающий сайт, не открывает десятки страниц в минуту.
 * Считаем отчёты, а не запросы: пачка в одном теле иначе умножала бы лимит.
 */
const REPORTS_PER_MINUTE = 60

/**
 * НОВЫХ видов нарушений с одного адреса в час. Настоящих видов у сайта — единицы, и
 * один браузер открывает их за несколько страниц; десятки новых видов от одного
 * отправителя — это сочинённые отчёты, которые забили бы сводку до потолка за минуту.
 */
const NEW_KINDS_PER_HOUR = 20

/** Ошибка базы — в журнал не чаще раза в минуту: отчёт идёт на каждый просмотр с нарушением. */
const DB_WARN_EVERY_MS = 60_000
let lastDbWarn = 0

const noContent = () => new Response(null, { status: 204 })

export async function POST(req: Request) {
  const ip = clientIp(req)
  const raw = await readBodyCapped(req, MAX_BODY)
  if (raw === null) return noContent()
  let body: unknown
  try {
    body = JSON.parse(raw.toString('utf8'))
  } catch {
    return noContent()
  }
  const mayAdd = async () => (await rateLimit(`csp-report-new:${ip}`, NEW_KINDS_PER_HOUR, 3_600_000)).ok
  try {
    for (const v of parseCspReports(body)) {
      const rl = await rateLimit(`csp-report:${ip}`, REPORTS_PER_MINUTE, 60_000)
      if (!rl.ok) return tooMany(rl)
      await recordCspViolation(v, mayAdd)
    }
  } catch (e) {
    // Отчёт важен меньше страниц: при недоступной базе он теряется молча для браузера,
    // а не превращается в 500 со стеком на каждый просмотр, заслоняя в журнале причину.
    const now = Date.now()
    if (now - lastDbWarn > DB_WARN_EVERY_MS) {
      lastDbWarn = now
      console.warn('[csp-report] отчёт не записан', e instanceof Error ? e.message : e)
    }
  }
  return noContent()
}
