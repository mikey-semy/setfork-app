import 'server-only'
import { and, desc, eq, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, templates, templateVersions, users, verificationReports } from '@/shared/db'
import { recordAudit } from '@/shared/audit'
import { captureError } from '@/shared/observability'
import { VERIFICATION_ORDER } from './queries/shared'
import { envLine, SHOW_FAILED_REPORTS_PUBLICLY } from './report-visibility'

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

  // Номер версии и адрес списка нужны СЛЕДУ подъёма (аудит и обновление страниц) —
  // берём их тем же запросом, что и уровень, а не тремя отдельными.
  const [version] = await db
    .select({
      level: templateVersions.verificationLevel,
      number: templateVersions.version,
      slug: templates.slug,
      ownerHandle: users.handle,
    })
    .from(templateVersions)
    .innerJoin(templates, eq(templates.id, templateVersions.templateId))
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(eq(templateVersions.id, input.versionId))

  const raise = shouldRaise(version?.level ?? null, input.kind, input.verdict)
  if (raise) {
    await db
      .update(templateVersions)
      .set({
        verificationLevel: 'machine_run',
        verifiedAt: new Date(),
        verifiedEnv: envLine(input.environment),
        // ⚠️ ЧЕЛОВЕКА СТИРАЕМ. `verified_by` называет того, кто ручался за уровень; после
        // машинного подъёма ручается МАШИНА, а в поле оставался человек, поставивший
        // ПРЕДЫДУЩИЙ уровень — то есть в базе он числился автором прогона, которого не
        // делал. Пусто здесь читается верно: уровень «проверено машиной», человека за
        // ним нет. Кто именно прогонял — записано в самом отчёте (`runner_id`).
        verifiedBy: null,
      })
      .where(eq(templateVersions.id, input.versionId))

    // ⚠️ ТОТ ЖЕ СЛЕД, ЧТО У РУЧНОГО ПУТИ. Ручная постановка уровня пишет аудит и
    // обновляет страницы; машинная не делала ни того ни другого — витрина с фильтром по
    // уровню продолжала отдавать старый, а «кто поднял» не было записано нигде. Правило
    // одно на оба входа, иначе оно не правило.
    await recordAudit('list.verify', {
      actorId: input.runnerId ?? null,
      targetType: 'list',
      targetId: input.templateId,
      meta: { verificationLevel: 'machine_run', version: version?.number ?? null, byRun: true, reportId: row.id },
    })
    // ⚠️ ИЗОЛИРОВАНО. Отчёт уже записан и уровень уже поднят — это точка невозврата, и
    // ронять вызов после неё нельзя. `revalidatePath` вне области запроса бросает
    // («static generation store missing»), а этот путь зовут не только из маршрута: приём
    // отчёта может прийти из очереди. Тот же урок, что с заголовками в аудите: побочный
    // эффект после точки невозврата глотает свою ошибку, а не отменяет сделанное.
    try {
      if (version?.ownerHandle && version.slug) revalidatePath(`/${version.ownerHandle}/${version.slug}`)
      revalidatePath('/explore')
    } catch (e) {
      captureError(e, { where: 'recordVerificationReport.revalidate', templateId: input.templateId })
    }
  }
  return { id: row.id, raisedLevel: raise }
}


/**
 * Последний отчёт ВЕРСИИ — то, что показывает витрина и читает агент до доверия.
 *
 * `forMaintainer` — смотрит ли тот, кто список ведёт. От этого зависит только показ
 * ПРОВАЛА, и только пока Р2c не решён в другую сторону (см. константу выше).
 */
export async function latestReport(versionId: string, forMaintainer = false) {
  // ⚠️ ОТБОР В SQL, А НЕ ПОСЛЕ. Раньше поднимались десять последних строк, и провалы
  // отбрасывались уже в памяти: десять подряд неудачных прогонов прятали более старый
  // УСПЕШНЫЙ отчёт, и посторонний видел «никогда не запускался». Это ровно та подмена,
  // которую запрещает абзац ниже, — только сделанная не показом, а размером выборки.
  //
  // Провал скрыт от посторонних: показываем последний НЕпровальный, а если такого нет —
  // ничего. Молчание честнее подмены: «прогоняли и не вышло» не превращается в
  // «не прогоняли» ни для кого, кроме показа.
  const hideFails = !SHOW_FAILED_REPORTS_PUBLICLY && !forMaintainer
  const [row] = await db
    .select()
    .from(verificationReports)
    .where(
      hideFails
        ? and(eq(verificationReports.versionId, versionId), ne(verificationReports.verdict, 'fails'))
        : eq(verificationReports.versionId, versionId),
    )
    .orderBy(desc(verificationReports.createdAt))
    .limit(1)
  return row ?? null
}

