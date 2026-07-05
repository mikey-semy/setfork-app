import 'server-only'
import { Code, ConnectError, createClient } from '@connectrpc/connect'
import { coreTransport } from '@/shared/core-transport'
import type { GitCore, GitRepoRef } from '@/core'
import { BranchOpError } from '@/core'
import { GitCore as GitCoreService, type RepoRef } from './gen/git_pb'

// Remote-реализация GitCore: Connect-ES → Rust git-core по gRPC (h2c, plaintext).
// Включается из core.ts по SETFORK_CORE_URL; адрес — SETFORK_CORE_ADDR.
// Семантика 1:1 с core.inproc.ts: сервис резолвит/лочит/проецирует репо ВНУТРИ,
// а тут только маппинг форм порт ↔ proto-сообщения.

// Единый транспорт к ядру (h2c + Bearer-токен канала, см. shared/core-transport).
const client = createClient(GitCoreService, coreTransport())

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
    return toSnapshot(res)
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

  async mergeBranch(repo, name) {
    try {
      const res = await client.mergeBranch({ repo: toRepoRef(repo), name })
      return { tipSha: res.tipSha, newVersion: toNewVersion(res.newVersion), fastForward: res.fastForward }
    } catch (e) {
      throw toBranchOpError(e)
    }
  },

  async mergeState(repo, branch) {
    const res = await client.getMergeState({ repo: toRepoRef(repo), branch }).catch(() => null)
    if (!res || !res.found || !res.base || !res.ours || !res.theirs) return null
    return {
      mergeBaseSha: res.mergeBaseSha,
      base: toSnapshot(res.base),
      ours: toSnapshot(res.ours),
      theirs: toSnapshot(res.theirs),
    }
  },

  async mergeResolved(repo, branch, listJson) {
    try {
      const res = await client.mergeResolved({ repo: toRepoRef(repo), branch, listJson: new TextEncoder().encode(listJson) })
      return { tipSha: res.tipSha, newVersion: toNewVersion(res.newVersion), fastForward: res.fastForward }
    } catch (e) {
      throw toBranchOpError(e)
    }
  },

  async createTag(repo, name, version) {
    try {
      const res = await client.createTag({ repo: toRepoRef(repo), name, version })
      return res.tipSha
    } catch (e) {
      throw toBranchOpError(e)
    }
  },

  async listTags(repo) {
    const res = await client.listTags(toRepoRef(repo)).catch(() => null)
    return res ? res.tags.map((t) => ({ name: t.name, targetSha: t.targetSha })) : []
  },
}

// pb-снапшот → форма порта (общий маппинг branchSnapshot/mergeState).
function toSnapshot(res: {
  tipSha: string
  title: string
  desc: string
  tags: string[]
  ordered: boolean
  steps: { n: number; title: string; desc: string; command: string; level: string; why: string; section: string; subtasks: string[]; refs: { label: string; url: string }[] }[]
}) {
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
}

// gRPC-статусы ядра → машиночитаемые коды порта (см. proto: комментарий у CreateBranch).
// failed_precondition различаем по message: merge шлёт 'conflict'/'nothing-to-merge',
// delete — 'main is protected'.
function toBranchOpError(e: unknown): BranchOpError {
  if (!(e instanceof ConnectError)) return new BranchOpError('internal')
  if (e.code === Code.InvalidArgument) return new BranchOpError('bad-name')
  if (e.code === Code.AlreadyExists) return new BranchOpError('exists')
  if (e.code === Code.NotFound) return new BranchOpError('not-found')
  if (e.code === Code.FailedPrecondition) {
    if (e.rawMessage.includes('conflict')) return new BranchOpError('conflict')
    if (e.rawMessage.includes('nothing-to-merge')) return new BranchOpError('nothing-to-merge')
    return new BranchOpError('protected')
  }
  return new BranchOpError('internal')
}
