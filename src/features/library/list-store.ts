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

export const listStore: ListStore = {
  ...drizzleStore,
  ...(remoteReads ? listReadRemote : {}),
  ...(remoteWrites ? listWriteRemote : {}),
}
