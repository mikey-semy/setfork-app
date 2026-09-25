import { parseCspReports, recordCspViolation } from '@/features/security/csp-reports'
import { clientIp, rateLimit, tooMany } from '@/shared/rate-limit'

/**
 * Приёмник отчётов о нарушениях CSP (адрес — `CSP_REPORT_PATH` в shared/security/csp.ts).
 *
 * Открыт без входа и без проверки Origin: отчёт шлёт сам браузер, без кук, и у
 * `report-uri` заголовка Origin может не быть вовсе. Ответ всегда 204 — браузер его не
 * читает, а подробности о том, что принято, отправителю ни к чему.
 */
export const runtime = 'nodejs'

/** Тело больше этого — не отчёт браузера: пачка из `MAX_REPORTS_PER_BODY` умещается с запасом. */
const MAX_BODY = 64 * 1024

/**
 * Отчётов с одного адреса в минуту. Браузер шлёт по отчёту на нарушение на странице;
 * человек, листающий сайт, не открывает десятки страниц в минуту.
 */
const PER_MINUTE = 60

const noContent = () => new Response(null, { status: 204 })

export async function POST(req: Request) {
  const rl = await rateLimit(`csp-report:${clientIp(req)}`, PER_MINUTE, 60_000)
  if (!rl.ok) return tooMany(rl)

  const text = await req.text()
  if (text.length > MAX_BODY) return noContent()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return noContent()
  }
  for (const v of parseCspReports(body)) await recordCspViolation(v)
  return noContent()
}
