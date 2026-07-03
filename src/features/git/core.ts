import 'server-only'
import type { GitCore } from '@/core'
import { gitCoreInproc } from './core.inproc'

// Feature-flag бэкенда git-ядра (Фаза 1 seam):
//   нет SETFORK_CORE_URL → inproc (shell→git, текущий)
//   есть SETFORK_CORE_URL → remote (Connect→Rust git-core, подключается в Фазе 2)
// Роут [...git] зависит только от порта GitCore — переключение без правки роута.
const REMOTE_TODO = 'git-core remote (Connect→Rust) не подключён — Фаза 2 (см. docs/phase1-wire-contract.md)'
const gitCoreRemote: GitCore = {
  infoRefsUploadPack: async () => {
    throw new Error(REMOTE_TODO)
  },
  infoRefsReceivePack: async () => {
    throw new Error(REMOTE_TODO)
  },
  uploadPack: async () => {
    throw new Error(REMOTE_TODO)
  },
  receivePack: async () => {
    throw new Error(REMOTE_TODO)
  },
  bundle: async () => {
    throw new Error(REMOTE_TODO)
  },
}

export const gitCore: GitCore = process.env.SETFORK_CORE_URL ? gitCoreRemote : gitCoreInproc
