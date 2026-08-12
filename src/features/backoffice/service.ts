import 'server-only'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { aiUsage, db, jobs, users } from '@/shared/db'
import { enqueueJob } from '@/shared/jobs/queue'
import { loopPolicy, recordAgentAction } from '@/shared/agents/policy'
import { autonomyHealthy } from '@/shared/agents/canary'
import { AI_DAILY_USD } from '@/shared/quota'
import { getOpenRouterCredits } from '@/shared/ai/credits'
import { isAdminHandle } from '@/shared/auth/admin-handle'
import { sendMail } from '@/shared/email/mailer'
import { appOrigin } from '@/shared/auth/app-origin'
import type { Lang } from '@/shared/i18n'
import { budgetAlerts, type Money } from '@/shared/agents/budget'
import { log } from '@/shared/observability'

/**
 * БЭК-ОФИС: две петли, которые до сих пор были страницами.
 *
 *   БУХГАЛТЕР (`finance`) — следит за расходом и остатком и САМ говорит, когда плохо.
 *   ЛЕТОПИСЕЦ (`chronicle`) — раз в день отправляет владельцу сводку дня компании.
 *
 * Оба контура заявлены автономными в докладной, но жили разделами дашборда: компания молчала,
 * пока на неё не посмотрят. Тревога, которую нужно пойти и увидеть, — это не тревога.
 *
 * Доставка — письмом владельцу через существующий отправитель. Новый тип уведомления в
 * колокольчике потребовал бы правок в четырёх местах интерфейса ради двух системных сообщений;
 * письмо доходит и без этого. Почта не настроена (`sendMail` вернёт false) — остаётся запись в
 * журнале, и это честно видно в его результате, а не молча теряется.
 *
 * НИ ОДНОГО ВЫЗОВА МОДЕЛИ в обеих петлях: обе считают числа, которые уже есть в БД.
 */

// Технические строки журнала (русские, не UI). Вынесены из тернарников: правило i18n принимает
// «строка ? строка» за двуязычный текст, а это записи для владельца в журнале компании.
const NO_ADDRESS = 'у админа нет адреса'
const MAIL_OFF = 'почта не настроена'
const QUIET_DAY = 'день без событий — писать не о чем'
const NO_EVENTS = 'нет событий'
const DRY_RUN = 'сухой прогон'
const ALREADY_SENT = 'за этот день уже отправлено'

const FINANCE_EVERY_HOURS = 6
const CHRONICLE_EVERY_HOURS = 24

export async function ensureFinanceScheduled(): Promise<void> {
  await ensureLoop('finance', FINANCE_EVERY_HOURS)
}

export async function ensureChronicleScheduled(): Promise<void> {
  await ensureLoop('chronicle', CHRONICLE_EVERY_HOURS)
}

async function ensureLoop(type: 'finance' | 'chronicle', everyHours: number): Promise<void> {
  const [pending] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, type), eq(jobs.status, 'pending')))
    .limit(1)
  if (pending) return
  await enqueueJob(type, {}, { delayMs: everyHours * 60 * 60 * 1000, maxAttempts: 1 })
}

/** Ссылка на дашборд в письмах владельцу. Хост — из appOrigin(), иначе письма
 *  со стенда зовут на прод, а после смены домена — на старый. */
const developmentDashboardLink = (): string => `<p><a href="${appOrigin()}/admin/development">Дашборд развития</a></p>`

/** Кому писать: владелец инстанса. Ищем по тем же правилам, что и права админа. */
async function ownerEmails(): Promise<Array<{ email: string; lang: Lang }>> {
  const rows = await db.select({ handle: users.handle, email: users.email, lang: users.lang }).from(users).where(sql`${users.email} is not null and ${users.email} <> ''`)
  return rows.filter((r) => isAdminHandle(r.handle) && r.email).map((r) => ({ email: r.email as string, lang: r.lang }))
}

/** Отправка владельцу. Возвращает, дошло ли: «почта не настроена» — тоже результат. */
async function tellOwner(subject: string, body: string): Promise<{ sent: number; skipped: string }> {
  const to = await ownerEmails()
  if (!to.length) return { sent: 0, skipped: NO_ADDRESS }
  let sent = 0
  for (const r of to) if (await sendMail({ to: r.email, lang: r.lang, subject, body })) sent++
  return { sent, skipped: sent ? '' : MAIL_OFF }
}

/** Деньги за сегодня и за неделю — то, из чего бухгалтер делает вывод. */
async function money(): Promise<Money> {
  const [today] = await db
    .select({ usd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float8` })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, sql`date_trunc('day', now())`))
  const [week] = await db
    .select({ usd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float8` })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, sql`now() - interval '7 days'`))
  const credits = await getOpenRouterCredits()
  return {
    spentToday: today?.usd ?? 0,
    avgDay: (week?.usd ?? 0) / 7,
    dailyCap: AI_DAILY_USD,
    balance: credits?.remaining ?? null,
  }
}

export interface FinanceResult {
  alerts: number
  sent: number
}

/**
 * Проход бухгалтера. Тревоги считает чистая функция (`shared/agents/budget`), здесь — данные,
 * доставка и журнал. Идемпотентность по ключу «тип тревоги + сутки»: одна и та же беда не
 * должна приходить каждые шесть часов, иначе владелец перестанет читать письма.
 */
export async function runFinanceSweep(): Promise<FinanceResult> {
  await ensureFinanceScheduled()
  const out: FinanceResult = { alerts: 0, sent: 0 }
  if (!(await autonomyHealthy('finance'))) return out
  const policy = await loopPolicy('finance')
  const m = await money()
  const alerts = budgetAlerts(m)

  if (policy.dryRun) {
    await recordAgentAction({
      loop: 'finance',
      action: 'money.watch',
      resultStatus: 'dry-run',
      signal: { ...m },
      decision: { wouldAlert: alerts.map((a) => a.kind) },
      policyVersion: policy.policyVersion,
    })
    return out
  }

  const day = new Date().toISOString().slice(0, 10)
  for (const a of alerts) {
    // Ключ заявляем ДО отправки: запись с уникальным ключом — это и есть заявка на право
    // отправить. Пиши мы журнал после письма, два инстанса (или проход после рестарта)
    // отправили бы одну тревогу дважды, а владелец перестал бы читать письма.
    const claimed = await recordAgentAction({
      loop: 'finance',
      action: 'money.alert',
      resultStatus: 'ok',
      signal: { ...m },
      decision: { kind: a.kind, text: a.text },
      idempotencyKey: `finance:${a.kind}:${day}`,
      policyVersion: policy.policyVersion,
    })
    if (!claimed) continue // ключ уже занят: эту тревогу сегодня уже отправляли
    out.alerts++
    const delivery = await tellOwner(`SetFork: ${a.subject}`, `<p>${a.text}</p>${developmentDashboardLink()}`)
    out.sent += delivery.sent
    // Не дошло — записываем ОТДЕЛЬНОЙ строкой без ключа: заявка уже занята, но факт «тревога
    // не доставлена» обязан быть виден, иначе журнал врал бы бодрым 'ok'.
    if (!delivery.sent) {
      await recordAgentAction({
        loop: 'finance',
        action: 'money.alert',
        resultStatus: 'skipped',
        signal: { ...m },
        decision: { kind: a.kind },
        error: delivery.skipped,
        policyVersion: policy.policyVersion,
      })
    }
  }
  if (!alerts.length) {
    await recordAgentAction({
      loop: 'finance',
      action: 'money.watch',
      resultStatus: 'ok',
      signal: { ...m },
      decision: { alerts: 0 },
      policyVersion: policy.policyVersion,
    })
  }
  log.info('finance sweep done', { ...out })
  return out
}

export interface ChronicleResult {
  sent: number
  skipped: string
}

/**
 * Проход летописца: сводка дня наверх. Раз в сутки и ровно один раз — ключ идемпотентности
 * по дате; повторный проход (рестарт, второй инстанс) письма не задвоит.
 */
export async function runChronicleSweep(): Promise<ChronicleResult> {
  await ensureChronicleScheduled()
  const out: ChronicleResult = { sent: 0, skipped: '' }
  if (!(await autonomyHealthy('chronicle'))) return out
  const policy = await loopPolicy('chronicle')
  const { getCompanyDay } = await import('@/shared/agents/company-day')
  // Отчитываемся о ЗАВЕРШЁННОМ дне, а не о текущем: проход встаёт раз в сутки от старта
  // процесса, а не в полночь, поэтому «сегодня» — это всегда обрезанный кусок дня.
  const day = await getCompanyDay(1)
  const date = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

  const rows: [string, number][] = [
    ['создано', day.created],
    ['улучшено', day.improved],
    // Предложенные правки — самый частый исход работы компании: своих списков у неё почти
    // нет. Без этой строки день, в котором она открыла десяток правок, считался бы пустым,
    // и летописец промолчал бы ровно о той работе, ради которой всё и заведено.
    ['предложено', day.proposed],
    ['опубликовано', day.published],
    ['придержано планкой', day.held],
    ['расхождений форком', day.forked],
    ['ошибок', day.errors],
  ]
  // Молчим, когда молчать честно: день без единого события — это не новость, а тишина.
  const quiet = rows.every(([, n]) => n === 0)

  if (policy.dryRun || quiet) {
    await recordAgentAction({
      loop: 'chronicle',
      action: 'day.report',
      resultStatus: policy.dryRun ? 'dry-run' : 'skipped',
      signal: { date, ...Object.fromEntries(rows) },
      decision: { reason: quiet ? QUIET_DAY : DRY_RUN },
      policyVersion: policy.policyVersion,
    })
    out.skipped = quiet ? NO_EVENTS : DRY_RUN
    return out
  }

  const html = `<p>День компании, ${date}:</p><ul>${rows.map(([k, n]) => `<li>${k}: ${n}</li>`).join('')}</ul>` +
    (day.holdReasons.length ? `<p>Почему не пропустила планка: ${day.holdReasons.map((r) => `${r.reason} (${r.times})`).join('; ')}</p>` : '') +
    developmentDashboardLink()
  // Ключ на дату — ДО отправки: две задачи на один день (рестарт, второй инстанс) иначе
  // прислали бы сводку дважды.
  const claimed = await recordAgentAction({
    loop: 'chronicle',
    action: 'day.report',
    resultStatus: 'ok',
    signal: { date, ...Object.fromEntries(rows) },
    decision: { day: date },
    idempotencyKey: `chronicle:${date}`,
    policyVersion: policy.policyVersion,
  })
  if (!claimed) {
    // Ключ занят — сводку за этот день уже отправили (рестарт, второй инстанс).
    out.skipped = ALREADY_SENT
    return out
  }
  const delivery = await tellOwner(`SetFork: день компании ${date}`, html)
  out.sent = delivery.sent
  out.skipped = delivery.skipped
  if (!delivery.sent) {
    await recordAgentAction({
      loop: 'chronicle',
      action: 'day.report',
      resultStatus: 'skipped',
      signal: { date },
      decision: { day: date },
      error: delivery.skipped,
      policyVersion: policy.policyVersion,
    })
  }
  return out
}

export async function runFinanceJob(): Promise<void> {
  try {
    await runFinanceSweep()
  } finally {
    await ensureFinanceScheduled()
  }
}

export async function runChronicleJob(): Promise<void> {
  try {
    await runChronicleSweep()
  } finally {
    await ensureChronicleScheduled()
  }
}
