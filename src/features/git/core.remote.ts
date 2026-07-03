import 'server-only'
import { createClient } from '@connectrpc/connect'
import { createGrpcTransport } from '@connectrpc/connect-node'
import type { GitCore, GitRepoRef } from '@/core'
import { GitCore as GitCoreService, type RepoRef } from './gen/git_pb'

// Remote-реализация GitCore: Connect-ES → Rust git-core по gRPC (h2c, plaintext).
// Включается из core.ts по SETFORK_CORE_URL; адрес — SETFORK_CORE_ADDR.
// Семантика 1:1 с core.inproc.ts: сервис резолвит/лочит/проецирует репо ВНУТРИ,
// а тут только маппинг форм порт ↔ proto-сообщения.

// h2c: gRPC поверх http/2 без TLS. По умолчанию — локальный dev-сервер.
const addr = process.env.SETFORK_CORE_ADDR ?? '127.0.0.1:50051'
const transport = createGrpcTransport({ baseUrl: `http://${addr}` })
const client = createClient(GitCoreService, transport)

// Порт разделяет owner/slug; в proto это вложенный RepoRef.
function toRepoRef(repo: GitRepoRef): RepoRef {
  // create() не нужен: для init-объекта достаточно частичной формы сообщения.
  return { owner: repo.owner, slug: repo.slug } as RepoRef
}

// proto: new_version = 0 означает «версия не создана» → порт ждёт null.
function toNewVersion(n: number): number | null {
  return n === 0 ? null : n
}

export const gitCoreRemote: GitCore = {
  async infoRefsUploadPack(repo, gitProtocol) {
    const res = await client.infoRefsUploadPack({
      repo: toRepoRef(repo),
      gitProtocol: gitProtocol ?? '',
    })
    return res.data
  },

  async infoRefsReceivePack(repo, gitProtocol) {
    const res = await client.infoRefsReceivePack({
      repo: toRepoRef(repo),
      gitProtocol: gitProtocol ?? '',
    })
    return res.data
  },

  async uploadPack(repo, body, gitProtocol) {
    const res = await client.uploadPack({
      repo: toRepoRef(repo),
      body,
      gitProtocol: gitProtocol ?? '',
    })
    return res.data
  },

  async receivePack(repo, body, gitProtocol) {
    const res = await client.receivePack({
      repo: toRepoRef(repo),
      body,
      gitProtocol: gitProtocol ?? '',
    })
    return { data: res.data, newVersion: toNewVersion(res.newVersion) }
  },

  async bundle(repo) {
    const res = await client.createBundle(toRepoRef(repo))
    return res.data
  },
}
