import 'server-only'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { and, eq } from 'drizzle-orm'
import type { BranchSnapshot, GitBranch, GitCore } from '@/core'
import { BranchOpError } from '@/core'
import { db, templates, users } from '@/shared/db'
import { gitStore } from './adapter'

const exec = promisify(execFile)

// Только простые имена веток (защита от ref-инъекций) — зеркало проверки в Rust-ядре.
const BRANCH_RE = /^[A-Za-z0-9._-]+$/
const badBranch = (b: string) => !b || !BRANCH_RE.test(b) || b.includes('..')

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

  async listBranches(repo) {
    const bare = await gitStore.ensureRepo(repo)
    if (!bare) return []
    const { stdout } = await exec('git', ['--git-dir', bare, 'for-each-ref', 'refs/heads', '--format=%(refname:short) %(objectname)'])
    const out: GitBranch[] = []
    for (const line of stdout.split('\n')) {
      const [name, tip] = line.trim().split(' ')
      if (!name || !tip) continue
      let ahead = 0
      let behind = 0
      if (name !== 'main') {
        // left-right main...branch: left = только в main (behind), right = только в ветке (ahead).
        const { stdout: lr } = await exec('git', ['--git-dir', bare, 'rev-list', '--left-right', '--count', `main...${name}`]).catch(() => ({ stdout: '0\t0' }))
        const [l, r] = lr.trim().split(/\s+/).map(Number)
        behind = l || 0
        ahead = r || 0
      }
      out.push({ name, tipSha: tip, isDefault: name === 'main', ahead, behind })
    }
    out.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
    return out
  },

  async branchSnapshot(repo, branch) {
    if (badBranch(branch)) return null
    const bare = await gitStore.ensureRepo(repo)
    if (!bare) return null
    let raw: string
    let tip: string
    try {
      ;[{ stdout: raw }, { stdout: tip }] = await Promise.all([
        exec('git', ['--git-dir', bare, 'show', `${branch}:list.json`], { maxBuffer: 8 * 1024 * 1024 }),
        exec('git', ['--git-dir', bare, 'rev-parse', branch]),
      ])
    } catch {
      return null
    }
    let parsed: {
      title?: string
      desc?: string
      tags?: string[]
      ordered?: boolean
      steps?: { title?: string; desc?: string; command?: string; level?: string; why?: string; section?: string; subtasks?: string[]; refs?: { label?: string; url?: string }[] }[]
    }
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
    // Набор/порядок шагов — из list.json (источник истины). Per-step md-оверрайды
    // применяет только Rust-канон; inproc — dev/demo-фолбэк без них.
    const steps: BranchSnapshot['steps'] = (parsed.steps ?? [])
      .filter((s) => (s.title ?? '').trim())
      .map((s, i) => ({
        n: i + 1,
        title: s.title ?? '',
        desc: s.desc ?? '',
        command: s.command ?? '',
        level: s.level || 'required',
        why: s.why ?? '',
        section: s.section ?? '',
        subtasks: s.subtasks ?? [],
        refs: (s.refs ?? [])
          .filter((r) => (r.label ?? '').trim())
          .map((r) => ({ label: r.label ?? '', ...(r.url ? { url: r.url } : {}) })),
      }))
    return {
      tipSha: tip.trim(),
      title: parsed.title ?? '',
      desc: parsed.desc ?? '',
      tags: parsed.tags ?? [],
      ordered: parsed.ordered ?? true,
      steps,
    }
  },

  async createBranch(repo, name, from) {
    const base = from || 'main'
    if (badBranch(name) || badBranch(base)) throw new BranchOpError('bad-name')
    const bare = await gitStore.ensureRepo(repo)
    if (!bare) throw new BranchOpError('not-found')
    // База должна существовать (различаем от «ветка уже есть»).
    const tip = await exec('git', ['--git-dir', bare, 'rev-parse', '--verify', `refs/heads/${base}`])
      .then((r) => r.stdout.trim())
      .catch(() => null)
    if (!tip) throw new BranchOpError('not-found')
    const exists = await exec('git', ['--git-dir', bare, 'rev-parse', '--verify', `refs/heads/${name}`]).then(() => true, () => false)
    if (exists) throw new BranchOpError('exists')
    await exec('git', ['--git-dir', bare, 'branch', name, base]).catch(() => {
      throw new BranchOpError('internal')
    })
    return tip
  },

  async deleteBranch(repo, name) {
    if (badBranch(name)) throw new BranchOpError('bad-name')
    if (name === 'main') throw new BranchOpError('protected') // main — канон
    const bare = await gitStore.ensureRepo(repo)
    if (!bare) throw new BranchOpError('not-found')
    const exists = await exec('git', ['--git-dir', bare, 'rev-parse', '--verify', `refs/heads/${name}`]).then(() => true, () => false)
    if (!exists) throw new BranchOpError('not-found')
    // -D: черновики удаляем без merged-проверки (в main они не вливаются проекцией).
    await exec('git', ['--git-dir', bare, 'branch', '-D', name]).catch(() => {
      throw new BranchOpError('internal')
    })
  },

  async mergeBranch(repo, name) {
    if (badBranch(name) || name === 'main') throw new BranchOpError('bad-name')
    const bare = await gitStore.ensureRepo(repo)
    if (!bare) throw new BranchOpError('not-found')
    const listId = await resolveListId(repo.owner, repo.slug)
    if (!listId) throw new BranchOpError('not-found')
    const tipOf = (ref: string) =>
      exec('git', ['--git-dir', bare, 'rev-parse', '--verify', `refs/heads/${ref}`]).then(
        (r) => r.stdout.trim(),
        () => null,
      )
    const branchTip = await tipOf(name)
    if (!branchTip) throw new BranchOpError('not-found')
    // Merge двигает main → под тем же локом, что и push (merge + проекция атомарно).
    return gitStore.withRepoLock(listId, async () => {
      const { stdout: lr } = await exec('git', ['--git-dir', bare, 'rev-list', '--left-right', '--count', `main...${name}`])
      const ahead = Number(lr.trim().split(/\s+/)[1] || 0)
      if (!ahead) throw new BranchOpError('nothing-to-merge')
      const isAncestor = await exec('git', ['--git-dir', bare, 'merge-base', '--is-ancestor', 'main', name]).then(() => true, () => false)
      let tipSha: string
      let fastForward = false
      if (isAncestor) {
        await exec('git', ['--git-dir', bare, 'update-ref', 'refs/heads/main', branchTip])
        tipSha = branchTip
        fastForward = true
      } else {
        // Bare-friendly merge: merge-tree --write-tree (exit 1 = конфликт) + commit-tree.
        const tree = await exec('git', ['--git-dir', bare, 'merge-tree', '--write-tree', 'main', name]).then(
          (r) => r.stdout.split('\n')[0].trim(),
          () => null,
        )
        if (!tree) throw new BranchOpError('conflict')
        const env = {
          ...process.env,
          GIT_AUTHOR_NAME: 'SetFork',
          GIT_AUTHOR_EMAIL: 'git@setfork.com',
          GIT_COMMITTER_NAME: 'SetFork',
          GIT_COMMITTER_EMAIL: 'git@setfork.com',
        }
        const { stdout: commit } = await exec(
          'git',
          ['--git-dir', bare, 'commit-tree', tree, '-p', 'main', '-p', name, '-m', `Merge branch '${name}'`],
          { env },
        )
        tipSha = commit.trim()
        await exec('git', ['--git-dir', bare, 'update-ref', 'refs/heads/main', tipSha])
      }
      // main сдвинулся → проекция (null = list.json не менялся).
      const newVersion = await gitStore.projectPushedCommit(listId, bare).catch(() => null)
      return { tipSha, newVersion, fastForward }
    })
  },
}
