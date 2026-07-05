import 'server-only'
import type { ListStore } from '@/core'
import { listStore as drizzleStore } from './list-store.adapter'
import { listReadRemote } from './list-store.remote'

// Фасад порта ListStore — точка катовера домена на Rust.
// READS уезжают на Rust ListRead при SETFORK_DOMAIN_READS=1 (требует работающего
// ядра: SETFORK_CORE_URL/ADDR, как git). WRITES пока всегда Drizzle (create/
// addVersion) — переезжают следующей фазой. Потребители импортируют ТОЛЬКО отсюда.
const remoteReads = !!process.env.SETFORK_CORE_URL && process.env.SETFORK_DOMAIN_READS === '1'

export const listStore: ListStore = remoteReads ? { ...drizzleStore, ...listReadRemote } : drizzleStore
