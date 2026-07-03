import 'server-only'
import type { GitProjection, GitStore } from '@/core'
import { bundleRepo, ensureRepo, withRepoLock } from './store'
import { projectPushedCommit } from './project'
import { receivePackAdvertise, receivePackRpc, uploadPackAdvertise, uploadPackRpc } from './smart-http'

// Адаптер порта GitStore (см. @/core/ports) поверх текущей TS-реализации
// (shell в `git` + персистентные bare-репо). Пост-MVP заменяется на Rust
// (gix read / git2 write) — потребители зависят только от порта, не от этого файла.
export const gitStore: GitStore & GitProjection = {
  ensureRepo: (ref) => ensureRepo(ref.owner, ref.slug),
  uploadPackAdvertise: (repo, gitProtocol) => uploadPackAdvertise(repo, gitProtocol),
  uploadPackRpc: (repo, body, gitProtocol) => uploadPackRpc(repo, Buffer.from(body), gitProtocol),
  receivePackAdvertise: (repo, gitProtocol) => receivePackAdvertise(repo, gitProtocol),
  receivePackRpc: (repo, body, gitProtocol) => receivePackRpc(repo, Buffer.from(body), gitProtocol),
  bundle: (ref) => bundleRepo(ref.owner, ref.slug),
  withRepoLock: (listId, fn) => withRepoLock(listId, fn),
  projectPushedCommit: (listId, repo) => projectPushedCommit(listId, repo),
}
