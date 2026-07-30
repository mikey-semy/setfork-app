import 'server-only'
import type { GitCore } from '@/core'
import { gitCoreRemote } from './core.remote'

/**
 * Git-ядро одно: Rust-сервис (Connect-ES → gRPC), адрес в SETFORK_CORE_ADDR.
 *
 * Раньше здесь была развилка: без SETFORK_CORE_URL фронт шеллил git сам
 * (core.inproc.ts). Вторая реализация означала, что правила формата списка
 * описаны дважды и сверяются побайтовыми эталонами — налог на КАЖДОЕ изменение
 * формата. В проде remote-режим и так был единственным, inproc доживал в dev и
 * на demo-стенде; удалён вместе со всей цепочкой (HQ tracks/git-format.md, Ф0b).
 *
 * Следствие для разработки: локально нужен запущенный core
 * (`docker compose up core`) — без ядра git-функции не обслуживаются.
 */
export const gitCore: GitCore = gitCoreRemote
