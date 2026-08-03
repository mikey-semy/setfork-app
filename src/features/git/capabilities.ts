import { gitCore } from './core'

/**
 * Ф5: подтвердило ли ядро, что исполняет роли.
 *
 * Пока не подтвердило — постороннего не пускаем: он оказался бы у ядра, которое
 * роль не смотрит вовсе, и `git push` в main прошёл бы как обычная запись.
 * Владельца и соавтора это не касается — их право не зависит от версии ядра.
 *
 * Ответ кэшируется, потому что вопрос задаётся на КАЖДОМ пуше, а меняется он
 * ровно при выкатке. Сроки разные и намеренно: «умеет» держим долго (ядро не
 * разучится само), «не умеет» — недолго, чтобы выкаченное ядро подхватилось
 * само, без перезапуска фронта.
 */
const CAP_TTL_MS = { yes: 600_000, no: 30_000 }
let capCache: { value: boolean; until: number } | null = null

export async function coreEnforcesPushRoles(now = Date.now()): Promise<boolean> {
  if (capCache && now < capCache.until) return capCache.value
  const { enforcesPushRoles } = await gitCore.capabilities()
  capCache = { value: enforcesPushRoles, until: now + (enforcesPushRoles ? CAP_TTL_MS.yes : CAP_TTL_MS.no) }
  return enforcesPushRoles
}

/** Только для тестов: сбросить запомненный ответ ядра. */
export const resetCoreCapabilityCache = () => {
  capCache = null
}
