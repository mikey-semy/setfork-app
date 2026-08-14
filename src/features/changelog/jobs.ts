import 'server-only'
import { captureError } from '@/shared/observability'
import { refreshChangelog, scheduleNextChangelog } from './service'

/**
 * Обновление changelog из GitHub.
 *
 * Самоподдерживающаяся: в конце ставит следующий проход по настройке периода.
 * Перепланируем ВСЕГДА, даже когда подсистема выключена, — иначе включение из
 * админки не начало бы работать без рестарта.
 */
export async function runChangelogJob(): Promise<void> {
  try {
    await refreshChangelog()
  } catch (e) {
    // Витрина не бизнес-процесс: сбой не должен ронять джобу в ретраи с backoff —
    // следующий проход и так по расписанию. Недоступность GitHub сюда уже не долетает:
    // сервис ловит её сам и пишет в журнал причину, так что здесь остаётся неожиданное.
    captureError(e, { where: 'changelog.refresh' })
  } finally {
    await scheduleNextChangelog()
  }
}
