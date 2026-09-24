import 'server-only'
import { createClient } from '@connectrpc/connect'
import { coreTransport } from '@/shared/core-transport'
import { GitCore } from '@/shared/gen/git_pb'

/**
 * ЧТО ЯДРО УМЕЕТ — прямо сейчас, без кэша.
 *
 * Один вызов на всех, кому это важно: роли пуша (`features/git/capabilities.ts`) и файлы
 * автора в записи (`features/library/list-store.remote.ts`). Две копии уже были — с разным
 * таймаутом рано или поздно разошлись бы.
 *
 * Почему без кэша: ядро могут откатить назад в любую минуту, а возможность, запомненная
 * про запас, действует дольше основания (авто-ревью fe#662).
 *
 * `null` — ядро НЕ ОТВЕТИЛО (обрыв, таймаут, UNIMPLEMENTED у совсем старого). Это не то же
 * самое, что «ответило: не умею», и вызывающему, который пишет отказ человеку или агенту,
 * различать их нужно: во втором случае ждать выкатки, в первом — просто повторить.
 */
const CAP_TIMEOUT_MS = 1000
const client = createClient(GitCore, coreTransport())

export interface CoreCapabilities {
  enforcesPushRoles: boolean
  acceptsAuthoredFiles: boolean
}

export async function coreCapabilities(timeoutMs = CAP_TIMEOUT_MS): Promise<CoreCapabilities | null> {
  const res = await client.getCapabilities({}, { timeoutMs }).catch(() => null)
  return res ? { enforcesPushRoles: res.enforcesPushRoles === true, acceptsAuthoredFiles: res.acceptsAuthoredFiles === true } : null
}
