import 'server-only'
import type { GitCore } from '@/core'
import { gitCoreInproc } from './core.inproc'
import { gitCoreRemote } from './core.remote'

// Feature-flag бэкенда git-ядра (Фаза 1 seam):
//   нет SETFORK_CORE_URL → inproc (shell→git, дефолт)
//   есть SETFORK_CORE_URL → remote (Connect-ES → Rust git-core; адрес SETFORK_CORE_ADDR)
// Роут [...git] зависит только от порта GitCore — переключение без правки роута.
export const gitCore: GitCore = process.env.SETFORK_CORE_URL ? gitCoreRemote : gitCoreInproc
