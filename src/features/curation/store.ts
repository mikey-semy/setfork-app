import 'server-only'
import { createClient } from '@connectrpc/connect'
import { createGrpcTransport } from '@connectrpc/connect-node'
import type { CurationStore } from '@/core'
import { CurationRead } from '@/features/git/gen/domain_read_pb'
import { curationStore as drizzleStore } from './adapter'

// Фасад порта CurationStore — точка катовера на Rust (как library/list-store.ts).
// READS (isStarred/isWatching/watchCount/watcherIds) уезжают на Rust CurationRead
// при SETFORK_DOMAIN_READS=1; мутации (toggle/ensure) — всегда Drizzle до фазы write.
// Потребители импортируют ТОЛЬКО отсюда.

const remoteReads = !!process.env.SETFORK_CORE_URL && process.env.SETFORK_DOMAIN_READS === '1'

function remote(): Partial<CurationStore> {
  const addr = process.env.SETFORK_CORE_ADDR ?? '127.0.0.1:50051'
  const client = createClient(CurationRead, createGrpcTransport({ baseUrl: `http://${addr}` }))
  return {
    async isStarred(listId, userId) {
      return (await client.isStarred({ listId, userId })).value
    },
    async isWatching(listId, userId) {
      return (await client.isWatching({ listId, userId })).value
    },
    async watchCount(listId) {
      return (await client.watchCount({ id: listId })).value
    },
    async watcherIds(listId) {
      return (await client.watcherIds({ id: listId })).ids
    },
  }
}

export const curationStore: CurationStore = remoteReads ? { ...drizzleStore, ...remote() } : drizzleStore
