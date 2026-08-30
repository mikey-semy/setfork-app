import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import { db, templateVersions, verificationReports } from '@/shared/db'
import { VERIFICATION_ORDER } from './queries/shared'

/**
 * ЗАПИСЬ ОТЧЁТА О ПРОГОНЕ и его влияние на уровень проверки версии.
 *
 * Отчёт — единственный способ появиться уровню `machine_run`: руками он недоступен,
 * иначе означал бы «машина проверяла» там, где машина не проверяла.
 *
 * ⚠️ ТОЛЬКО ДОБАВЛЕНИЕ. Функция вставляет и никогда не обновляет: новый прогон — новая
 * запись. Правка отчёта задним числом превратила бы историю прогонов в рассказ о
 * прошлом, а она и есть то, ради чего всё затевалось.
 */
/**
 * ⚠️ Р2c — РЕШЕНИЕ ВЛАДЕЛЬЦА, СВЕДЁННОЕ К ОДНОЙ СТРОКЕ.
 *
 * Виден ли ПРОВАЛЬНЫЙ отчёт постороннему на публичной странице списка.
 *
 * `true` (умолчание) — виден. Это рекомендация спеки и дух всего проекта: честные
 * счётчики, отсутствие тихой деградации, «отчёт называет проверенное». Провал —
 * законная запись, и прятать его значило бы показывать витрину, на которой видно
 * только удачное, то есть ровно ту метку без предмета, против которой всё затевалось.
 *
 * `false` — провал виден только тем, кто список ведёт (автор и соавторы); посторонний
 * видит последний УСПЕШНЫЙ отчёт, если он есть, и ничего, если его нет.
 *
 * Смена значения — одна строка здесь, без правок в разметке и запросах: цена решения
 * не должна зависеть от того, когда оно принято.
 */
export const SHOW_FAILED_REPORTS_PUBLICLY = true

export type ReportInput = {
  templateId: string
  versionId: string
  runId?: string | null
  kind: 'machine' | 'manual'
  task: string
  environment: Record<string, string>
  steps: { n: number; status: 'pass' | 'fail' | 'skip'; note?: string }[]
  verdict: 'works' | 'works_with_caveats' | 'fails'
  notes?: string
  runnerId?: string | null
}

/**
 * Поднимает ли успешный machine-отчёт уровень версии.
 *
 * ⚠️ ТОЛЬКО ВВЕРХ И ТОЛЬКО ДО `machine_run`. Версия, которую человек прогнал руками
 * целиком («кристалл»), после машинного прогона не должна становиться «прогнано
 * машиной»: это было бы ПОНИЖЕНИЕМ утверждения — машина проверяет меньше, чем человек.
 * И повторный прогон ничего не меняет: уровень уже стоит.
 *
 * Провал уровень не трогает вовсе — ни вверх, ни вниз. Версия остаётся с прежним
 * уровнем и видимым провалившимся отчётом: это разные утверждения, и подменять одно
 * другим значило бы прятать провал за меткой.
 */
function shouldRaise(current: string | null, kind: ReportInput['kind'], verdict: ReportInput['verdict']): boolean {
  if (kind !== 'machine' || verdict === 'fails') return false
  const now = VERIFICATION_ORDER.indexOf((current ?? '') as (typeof VERIFICATION_ORDER)[number])
  const target = VERIFICATION_ORDER.indexOf('machine_run')
  // now === -1 значит «порода» (в порядке её нет): поднимаем.
  return now < target
}

export async function recordVerificationReport(input: ReportInput): Promise<{ id: string; raisedLevel: boolean }> {
  const [row] = await db
    .insert(verificationReports)
    .values({
      templateId: input.templateId,
      versionId: input.versionId,
      runId: input.runId ?? null,
      kind: input.kind,
      task: input.task,
      environment: input.environment,
      steps: input.steps,
      verdict: input.verdict,
      notes: input.notes ?? '',
      runnerId: input.runnerId ?? null,
    })
    .returning({ id: verificationReports.id })

  const [version] = await db
    .select({ level: templateVersions.verificationLevel })
    .from(templateVersions)
    .where(eq(templateVersions.id, input.versionId))

  const raise = shouldRaise(version?.level ?? null, input.kind, input.verdict)
  if (raise) {
    await db
      .update(templateVersions)
      .set({ verificationLevel: 'machine_run', verifiedAt: new Date(), verifiedEnv: envLine(input.environment) })
      .where(eq(templateVersions.id, input.versionId))
  }
  return { id: row.id, raisedLevel: raise }
}

/** Окружение одной строкой для метки: «claude-code 2.x · ubuntu 24.04». */
export function envLine(environment: Record<string, string>): string {
  return Object.values(environment).filter(Boolean).join(' · ').slice(0, 200)
}

/**
 * Последний отчёт ВЕРСИИ — то, что показывает витрина и читает агент до доверия.
 *
 * `forMaintainer` — смотрит ли тот, кто список ведёт. От этого зависит только показ
 * ПРОВАЛА, и только пока Р2c не решён в другую сторону (см. константу выше).
 */
export async function latestReport(versionId: string, forMaintainer = false) {
  const rows = await db
    .select()
    .from(verificationReports)
    .where(eq(verificationReports.versionId, versionId))
    .orderBy(desc(verificationReports.createdAt))
    .limit(10)
  if (rows.length === 0) return null
  if (SHOW_FAILED_REPORTS_PUBLICLY || forMaintainer) return rows[0]
  // Провал скрыт от посторонних: показываем последний НЕпровальный, а если такого нет —
  // ничего. Молчание честнее подмены: «прогоняли и не вышло» не превращается в
  // «не прогоняли» ни для кого, кроме показа.
  return rows.find((r) => r.verdict !== 'fails') ?? null
}

/** Все отчёты версии, свежие сверху: полная история прогонов для страницы отчёта. */
export async function reportsOfVersion(templateId: string, versionId: string) {
  return db
    .select()
    .from(verificationReports)
    .where(and(eq(verificationReports.templateId, templateId), eq(verificationReports.versionId, versionId)))
    .orderBy(desc(verificationReports.createdAt))
}
