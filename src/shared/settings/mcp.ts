import 'server-only'
import { inArray } from 'drizzle-orm'
import { appSettings, db } from '@/shared/db'

/**
 * Настройки поверхности MCP — из админки (appSettings), как у остальных разделов.
 *
 * `commiticsListId` — id СПИСКА с методом Commitics, по которому работает сценарий
 * `commitics`. Именно id, а не адрес: адрес списка меняется (переименование, смена ника),
 * а освободившийся ник через 180 дней может занять другой человек и положить свой список
 * с тем же слагом — сценарий с адресом в коде повёл бы каждого агента по чужим правилам.
 * Пусто — метод не настроен, и сценарий говорит об этом прямо.
 */
export const MCP_KEYS = {
  commiticsListId: 'mcp.commitics_list_id',
} as const

export interface McpSettings {
  commiticsListId: string | null
}

const TTL_MS = 5_000
let cache: { value: McpSettings; ts: number } | null = null
export function clearMcpCache(): void {
  cache = null
}

export async function getMcpSettings(): Promise<McpSettings> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.value
  let m: Record<string, string> = {}
  try {
    const rows = await db.select().from(appSettings).where(inArray(appSettings.key, Object.values(MCP_KEYS)))
    m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  } catch {
    // БД недоступна — «не настроено»: сценарий скажет это, а не поведёт агента вслепую.
  }
  const value: McpSettings = { commiticsListId: m[MCP_KEYS.commiticsListId]?.trim() || null }
  cache = { value, ts: Date.now() }
  return value
}
