import 'server-only'
import { getSettings, saveSettings } from './kv'

// Режим «сайт на ремонте». Оперативный флаг живёт в БД (appSettings) и
// управляется из админки; env SETFORK_MAINTENANCE=1 — аварийный оверрайд
// (когда БД лежит или нужен рубильник помимо интерфейса), из UI не выключается.

export const MAINTENANCE_KEY = 'maintenance.on'

// Кэш для middleware: флаг читается на каждый запрос — держим в памяти с TTL.
// Мульти-инстанс подхватит смену за ≤TTL; свой инстанс — мгновенно (setMaintenance).
const TTL_MS = 5_000
let cached: { on: boolean; ts: number } | null = null

/** Env-оверрайд активен? (показываем в админке отдельно — из UI не снять). */
export function maintenanceEnvOverride(): boolean {
  return process.env.SETFORK_MAINTENANCE === '1'
}

/** Быстрая проверка для middleware (кэш). Ошибка БД = false: флаг ремонта
 *  не должен сам ронять сайт при флапе базы (fail-open). */
export async function maintenanceEnabled(): Promise<boolean> {
  if (maintenanceEnvOverride()) return true
  const now = Date.now()
  if (cached && now - cached.ts < TTL_MS) return cached.on
  let on = false
  try {
    const map = await getSettings([MAINTENANCE_KEY])
    on = map[MAINTENANCE_KEY] === '1'
  } catch {
    on = cached?.on ?? false
  }
  cached = { on, ts: now }
  return on
}

/** Текущее значение БД-флага без кэша — для админки. */
export async function maintenanceFlag(): Promise<boolean> {
  const map = await getSettings([MAINTENANCE_KEY])
  return map[MAINTENANCE_KEY] === '1'
}

export async function setMaintenance(on: boolean): Promise<void> {
  await saveSettings({ [MAINTENANCE_KEY]: on ? '1' : '' }) // '' = delete (см. kv)
  cached = { on, ts: Date.now() }
}
