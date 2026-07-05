import 'server-only'
import { Code, ConnectError, createClient } from '@connectrpc/connect'
import { createGrpcTransport } from '@connectrpc/connect-node'
import type { GitCore, GitRepoRef } from '@/core'
import { BranchOpError } from '@/core'
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

  async listBranches(repo) {
    const res = await client.listBranches(toRepoRef(repo))
    return res.branches.map((b) => ({
      name: b.name,
      tipSha: b.tipSha,
      isDefault: b.isDefault,
      ahead: b.ahead,
      behind: b.behind,
    }))
  },

  async branchSnapshot(repo, branch) {
    const res = await client.getBranchSnapshot({ repo: toRepoRef(repo), branch }).catch(() => null)
    if (!res || !res.found) return null
    return {
      tipSha: res.tipSha,
      title: res.title,
      desc: res.desc,
      tags: res.tags,
      ordered: res.ordered,
      steps: res.steps.map((s) => ({
        n: s.n,
        title: s.title,
        desc: s.desc,
        command: s.command,
        level: s.level,
        why: s.why,
        section: s.section,
        subtasks: s.subtasks,
        refs: s.refs.map((r) => ({ label: r.label, ...(r.url ? { url: r.url } : {}) })),
      })),
    }
  },

  async createBranch(repo, name, from) {
    try {
      const res = await client.createBranch({ repo: toRepoRef(repo), name, from: from ?? '' })
      return res.tipSha
    } catch (e) {
      throw toBranchOpError(e)
    }
  },

  async deleteBranch(repo, name) {
    try {
      await client.deleteBranch({ repo: toRepoRef(repo), name })
    } catch (e) {
      throw toBranchOpError(e)
    }
  },
}

// gRPC-статусы ядра → машиночитаемые коды порта (см. proto: комментарий у CreateBranch).
function toBranchOpError(e: unknown): BranchOpError {
  const code = e instanceof ConnectError ? e.code : null
  if (code === Code.InvalidArgument) return new BranchOpError('bad-name')
  if (code === Code.AlreadyExists) return new BranchOpError('exists')
  if (code === Code.NotFound) return new BranchOpError('not-found')
  if (code === Code.FailedPrecondition) return new BranchOpError('protected')
  return new BranchOpError('internal')
}
