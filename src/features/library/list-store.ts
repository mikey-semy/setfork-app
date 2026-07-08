import 'server-only'
import type { ListStore } from '@/core'
import { listStore as drizzleStore } from './list-store.adapter'
import { listReadRemote, listWriteRemote } from './list-store.remote'

// Фасад порта ListStore — точка катовера домена на Rust.
// READS → Rust ListRead при SETFORK_DOMAIN_READS=1; WRITES (addVersion) → Rust
// ListWrite при SETFORK_DOMAIN_WRITES=1 (отдельный, более осторожный флаг —
// транзакции). create — пока всегда Drizzle. Требует работающего ядра
// (SETFORK_CORE_URL/ADDR). Потребители импортируют ТОЛЬКО отсюда.
const coreOn = !!process.env.SETFORK_CORE_URL
const remoteReads = coreOn && process.env.SETFORK_DOMAIN_READS === '1'
const remoteWrites = coreOn && process.env.SETFORK_DOMAIN_WRITES === '1'

const base: ListStore = {
  ...drizzleStore,
  ...(remoteReads ? listReadRemote : {}),
  ...(remoteWrites ? listWriteRemote : {}),
}

// Хук «после addVersion»: регистрируется в composition root (instrumentation),
// чтобы фасад library НЕ импортировал moderation напрямую — границы слоёв запрещают
// features зависеть друг от друга (инверсия, как registerIndexSource). До регистрации
// пусто — безопасно (addVersion до старта воркера не вызывается).
type AfterVersionHook = (templateId: string) => Promise<void>
let afterVersion: AfterVersionHook | null = null
export function registerAfterVersion(fn: AfterVersionHook): void {
  afterVersion = fn
}

// Барьер модерации: новая версия = изменение контента → пере-проверка публичного
// списка. Раньше recheckList звался вручную на каждом addVersion-пути (saveNewVersion,
// acceptSuggestion, MCP, gardener) — забытый вызов = «отмывка» (залил чистое, прошёл
// модерацию, подменил на нарушающее). Теперь recheck висит на фасаде addVersion — единой
// точке, которую обойти нельзя. Сам recheckList самозащищён по visibility и
// дедуплицируется, поэтому хук безопасен для всех вызывающих.
export const listStore: ListStore = {
  ...base,
  async addVersion(templateId, input) {
    const ver = await base.addVersion(templateId, input)
    if (afterVersion) {
      try {
        await afterVersion(templateId)
      } catch {
        /* модерация не должна ронять сохранение версии — recheckList и так глушит свои ошибки */
      }
    }
    return ver
  },
}
