import 'server-only'
import { createClient } from '@connectrpc/connect'
import { coreTransport } from '@/shared/core-transport'
import type { CurationStore } from '@/core'
import { CurationRead, CurationWrite } from '@/shared/gen/domain_read_pb'
import { curationStore as drizzleStore } from './adapter'

// Фасад порта CurationStore — точка катовера на Rust (как library/list-store.ts).
// READS (isStarred/isWatching/watchCount/watcherIds) → Rust CurationRead при
// SETFORK_DOMAIN_READS=1; WRITES (toggleStar/toggleWatch/ensureWatch) → Rust
// CurationWrite при отдельном SETFORK_DOMAIN_WRITES=1 (более осторожный флаг).
// Потребители импортируют ТОЛЬКО отсюда.

const coreOn = !!process.env.SETFORK_CORE_URL
const remoteReads = coreOn && process.env.SETFORK_DOMAIN_READS === '1'
const remoteWrites = coreOn && process.env.SETFORK_DOMAIN_WRITES === '1'

function reads(): Partial<CurationStore> {
  const client = createClient(CurationRead, coreTransport())
  return {
    // isWatching/watchCount/watcherIds НЕ проксируем в Rust: их семантика теперь завязана
    // на watch_level/events, а прото CurationRead этого пока не знает → идут через drizzle.
    async isStarred(listId, userId) {
      return (await client.isStarred({ listId, userId })).value
    },
  }
}

function writes(): Partial<CurationStore> {
  const client = createClient(CurationWrite, coreTransport())
  return {
    async toggleStar(listId, userId) {
      return (await client.toggleStar({ listId, userId })).value
    },
    async toggleWatch(listId, userId) {
      return (await client.toggleWatch({ listId, userId })).value
    },
    async ensureWatch(listId, userId) {
      await client.ensureWatch({ listId, userId })
    },
  }
}

export const curationStore: CurationStore = {
  ...drizzleStore,
  ...(remoteReads ? reads() : {}),
  ...(remoteWrites ? writes() : {}),
}
