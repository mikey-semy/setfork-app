import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { GitCore } from '@/core'
import { db, templates, users } from '@/shared/db'
import { gitStore } from './adapter'

// In-process реализация GitCore поверх низкоуровневого GitStore (shell → git).
// Пост-MVP этот же порт закрывает remote-реализация (Connect → Rust git-core).

async function resolveListId(owner: string, slug: string): Promise<string | null> {
  const [r] = await db
    .select({ id: templates.id })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(users.handle, owner), eq(templates.slug, slug)))
    .limit(1)
  return r?.id ?? null
}

export const gitCoreInproc: GitCore = {
  async infoRefsUploadPack(repo, gitProtocol) {
    const bare = await gitStore.ensureRepo(repo)
    return bare ? gitStore.uploadPackAdvertise(bare, gitProtocol) : null
  },

  async infoRefsReceivePack(repo, gitProtocol) {
    const bare = await gitStore.ensureRepo(repo)
    return bare ? gitStore.receivePackAdvertise(bare, gitProtocol) : null
  },

  async uploadPack(repo, body, gitProtocol) {
    const bare = await gitStore.ensureRepo(repo)
    return bare ? gitStore.uploadPackRpc(bare, body, gitProtocol) : null
  },

  async receivePack(repo, body, gitProtocol) {
    const bare = await gitStore.ensureRepo(repo)
    if (!bare) return null
    const listId = await resolveListId(repo.owner, repo.slug)
    if (!listId) return null
    // receive-pack + проекция под одним локом (ленивый append не вклинивается).
    return gitStore.withRepoLock(listId, async () => {
      const data = await gitStore.receivePackRpc(bare, body, gitProtocol)
      const newVersion = await gitStore.projectPushedCommit(listId, bare).catch(() => null)
      return { data, newVersion }
    })
  },

  bundle: (repo) => gitStore.bundle(repo),
}
