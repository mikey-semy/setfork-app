import { envNumber } from '@/shared/env'

/**
 * Ф2: политика повторов упавшего пуша зеркала — ОДНО место для правила.
 *
 * Отдельным модулем от `mirror-jobs`, потому что правило нужно двоим: тому, кто
 * повторяет, и настройкам, которые обещают владельцу время следующей попытки.
 * Разъехавшись, они начали бы врать: интерфейс показывал бы «повторим», когда
 * повторов уже не будет. Здесь нет ни базы, ни `server-only` — значит, страница
 * настроек не тянет за собой очередь задач ради одного числа.
 */

/** Сколько неудач подряд терпим, прежде чем звать владельца руками. */
export const MIRROR_MAX_ATTEMPTS = envNumber('SETFORK_MIRROR_MAX_ATTEMPTS', 5)

/** База паузы между повторами. */
const BACKOFF_MS = envNumber('SETFORK_MIRROR_BACKOFF_MIN', 10) * 60_000

/**
 * Пауза после `attempts` неудач подряд — экспонента с потолком в сутки.
 * Отозванный токен чинят руками и не за минуту, поэтому пятая попытка уместна
 * через часы, а не пять раз подряд через десять минут.
 */
export function mirrorRetryDelayMs(attempts: number): number {
  return Math.min(BACKOFF_MS * 2 ** Math.max(0, attempts - 1), 24 * 3600_000)
}

/**
 * Когда зеркало можно трогать снова. `syncedAt` — время последней ПОПЫТКИ:
 * ядро обновляет отметку при любом исходе, включая неудачный. null (не пробовали
 * ни разу) — можно сразу.
 */
export function mirrorRetryDueAt(attempts: number, syncedAt: Date | null): Date {
  return syncedAt ? new Date(syncedAt.getTime() + mirrorRetryDelayMs(attempts)) : new Date(0)
}
