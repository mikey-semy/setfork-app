import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, jobs, templates, users } from '@/shared/db'
import { enqueueJob } from '@/shared/jobs/queue'
import { HOME_REALM } from '@/shared/ai/gnome-names'
import { log } from '@/shared/observability'
import { GARDENER_EVERY_DAYS, LIVING_EVERY_HOURS } from './schedule'

/** Ник сервисного аккаунта — здесь же, где он заводится. Ритм — в schedule. */
const GARDENER_HANDLE = 'gardener'

/**
 * Сервисный аккаунт садовника и его расписание.
 *
 * Отдельно от самого прохода: аккаунт заводится один раз и живёт по правилам ADR-0004
 * (агент помечен как агент), а проход меняется вместе с тем, что садовник делает со
 * списками.
 */

/**
 * Сервисный аккаунт садовника (создаётся при первом прогоне; входа у него нет).
 *
 * Существующую строку ДОЧИНИВАЕМ: на проде садовник был создан раньше, чем появилась
 * пометка account_type, и после деплоя остался бы «человеком» — то есть ровно то, что
 * ADR-0004 запрещает. Разовым скриптом такое чинить нельзя: он забывается, а инвариант
 * должен держать код. Апдейт узкий (только пустые/дефолтные поля) и идемпотентный —
 * заданные вручную значения не перетираем.
 */
export async function ensureGardenerUser(): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: users.id, accountType: users.accountType, profession: users.profession, location: users.location })
    .from(users)
    .where(eq(users.handle, GARDENER_HANDLE))
  if (existing) {
    if (existing.accountType !== 'agent' || !existing.profession || !existing.location) {
      await db
        .update(users)
        .set({
          accountType: 'agent',
          profession: existing.profession || 'Gardener',
          location: existing.location || HOME_REALM,
        })
        .where(eq(users.id, existing.id))
      log.info('gardener user marked as service account', { id: existing.id })
    }
    return { id: existing.id }
  }
  const [created] = await db
    .insert(users)
    .values({
      handle: GARDENER_HANDLE,
      name: 'SetFork Gardener',
      // account_type='agent' (ADR-0004): служебность стала ДАННЫМИ, а не догадкой по
      // handle и эмодзи в bio — UI и API обязаны показывать, что это не человек.
      accountType: 'agent',
      profession: 'Gardener',
      location: HOME_REALM,
      bio: '\u{1F9D9} Gardener. I propose improvements to public lists; humans review and merge.',
    })
    .returning({ id: users.id })
  log.info('gardener user created', { id: created.id })
  return created
}

/**
 * Одна ОЖИДАЮЩАЯ джоба садовника в очереди — самоподдержание без cron.
 *
 * Считаем только `pending`, и это принципиально: планировщик зовётся ИЗ САМОЙ задачи, а она в
 * этот момент `processing`. Учитывая её, проверка видела бы «работа уже стоит» и преемника не
 * ставила — петля тихо умирала бы после первого прогона и оживала только рестартом инстанса
 * (нашёл ревьюер Codex на #532; проверено тестом контракта петель).
 */
export async function ensureGardenerScheduled(): Promise<void> {
  const pending = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, 'gardener'), eq(jobs.status, 'pending')))
    .limit(1)
  if (pending.length) return
  // РИТМ ЗАДАЁТ СОДЕРЖИМОЕ. Раз в двое суток — нормальный темп для полировки, но для ленты
  // это не темп: новость, добавленная через два дня, уже не новость. Пока в библиотеке есть
  // хоть один живой список, проход встаёт чаще. Отдельную петлю не заводим: рубильник,
  // журнал, предохранитель и бюджет у ухода уже есть, а второй петле их пришлось бы
  // повторить — и разъехаться с этой при первой же правке.
  const [alive] = await db.select({ id: templates.id }).from(templates).where(eq(templates.living, true)).limit(1)
  const delayMs = alive ? LIVING_EVERY_HOURS * 60 * 60 * 1000 : GARDENER_EVERY_DAYS * 24 * 60 * 60 * 1000
  // maxAttempts:1 — без ретрая всего прохода: при повторе уже авто-смёрдженные
  // кураторские списки рефайнились бы заново (двойной расход). Пропуск одного
  // прохода не страшен — следующий встаёт по расписанию.
  await enqueueJob('gardener', {}, { delayMs, maxAttempts: 1 })
  log.info('gardener scheduled', { inHours: delayMs / 3_600_000, living: !!alive })
}
