import 'server-only'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { and, eq } from 'drizzle-orm'
import type { BranchSnapshot, GitBranch, GitCore } from '@/core'
import { BranchOpError } from '@/core'
import { db, templates, users } from '@/shared/db'
import { gitStore } from './adapter'
import { GIT_LOG_FORMAT, parseGitLog } from './log-parse'

const exec = promisify(execFile)

// Только простые имена веток (защита от ref- и argument-инъекций) — зеркало проверки
// в Rust-ядре. Ведущий '-' запрещён ОТДЕЛЬНО: BRANCH_RE его пропускает (дефис — в классе),
// но как позиционный arg git трактует '-D' и т.п. как ФЛАГ — напр. `git branch -D main`
// удалил бы защищённый main. См. security-скан 2026-07-23, F3 (CWE-88). Все пользовательские
// имена веток/тегов проходят через badBranch, так что это закрывает весь класс инъекции.
const BRANCH_RE = /^[A-Za-z0-9._-]+$/
const badBranch = (b: string) => !b || !BRANCH_RE.test(b) || b.includes('..') || b.startsWith('-')

// In-process реализация GitCore поверх низкоуровневого GitStore (shell → git).
// Пост-MVP этот же порт закрывает remote-реализация (Connect → Rust git-core).

/** Текущий tip main (или null, если ветки ещё нет). */
async function mainTip(bare: string): Promise<string | null> {
  return exec('git', ['--git-dir', bare, 'rev-parse', '--verify', 'refs/heads/main']).then(
    (r) => r.stdout.trim(),
    () => null,
  )
}

/** Идентичность merge-коммитов — та же, что у детерминированных коммитов bundle. */
const MERGE_ENV = {
  GIT_AUTHOR_NAME: 'SetFork',
  GIT_AUTHOR_EMAIL: 'git@setfork.com',
  GIT_COMMITTER_NAME: 'SetFork',
  GIT_COMMITTER_EMAIL: 'git@setfork.com',
}

/**
 * Merge двух рефов в bare-репо БЕЗ рабочего дерева: merge-tree --write-tree
 * (exit 1 = конфликт) + commit-tree. Ref НЕ двигается — это делает вызывающий.
 *
 * Один помощник на два направления: «ветка → main» (слияние предложения) и
 * «main → ветка» (обновление ветки). Различаются только порядком родителей.
 */
async function mergeCommit(bare: string, ours: string, theirs: string, message: string): Promise<string> {
  const tree = await exec('git', ['--git-dir', bare, 'merge-tree', '--write-tree', ours, theirs]).then(
    (r) => r.stdout.split('\n')[0].trim(),
    () => null,
  )
  if (!tree) throw new BranchOpError('conflict')
  const { stdout } = await exec(
    'git',
    ['--git-dir', bare, 'commit-tree', tree, '-p', ours, '-p', theirs, '-m', message],
    { env: { ...process.env, ...MERGE_ENV } },
  )
  return stdout.trim()
}

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
      const before = await mainTip(bare)
      const data = await gitStore.receivePackRpc(bare, body, gitProtocol)
      const after = await mainTip(bare)
      // Проецируем в версию ТОЛЬКО если push сдвинул main. Пуш в ветку-черновик
      // main не двигает → иначе из неизменного main плодились бы дубли версий.
      const moved = !!after && after !== before
      const newVersion = moved ? await gitStore.projectPushedCommit(listId, bare).catch(() => null) : null
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
    return snapshotAt(bare, branch)
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
    if (!(await tipOf(name))) throw new BranchOpError('not-found') // ранняя проверка вне лока
    // Merge двигает main → под тем же локом, что и push (merge + проекция атомарно).
    return gitStore.withRepoLock(listId, async () => {
      // tip ветки перечитываем ВНУТРИ лока: конкурентный push в эту ветку между
      // проверкой выше и захватом лока иначе сделал бы ff на устаревший коммит
      // и потерял только что запушенное (совпадает с Rust: tip читается под guard).
      const branchTip = await tipOf(name)
      if (!branchTip) throw new BranchOpError('not-found')
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
        tipSha = await mergeCommit(bare, 'main', name, `Merge branch '${name}'`)
        await exec('git', ['--git-dir', bare, 'update-ref', 'refs/heads/main', tipSha])
      }
      // main сдвинулся → проекция (null = list.json не менялся).
      const newVersion = await gitStore.projectPushedCommit(listId, bare).catch(() => null)
      return { tipSha, newVersion, fastForward }
    })
  },

  async mergeState(repo, branch) {
    if (badBranch(branch) || branch === 'main') return null
    const bare = await gitStore.ensureRepo(repo)
    if (!bare) return null
    const baseSha = await exec('git', ['--git-dir', bare, 'merge-base', 'main', `refs/heads/${branch}`]).then(
      (r) => r.stdout.trim(),
      () => null,
    )
    if (!baseSha) return null
    const [base, ours, theirs] = await Promise.all([
      snapshotAt(bare, baseSha),
      snapshotAt(bare, 'main'),
      snapshotAt(bare, `refs/heads/${branch}`),
    ])
    if (!base || !ours || !theirs) return null
    return { mergeBaseSha: baseSha, base, ours, theirs }
  },

  async mergeResolved(repo, branch, listJson) {
    if (badBranch(branch) || branch === 'main') throw new BranchOpError('bad-name')
    try {
      JSON.parse(listJson)
    } catch {
      throw new BranchOpError('bad-name')
    }
    const bare = await gitStore.ensureRepo(repo)
    if (!bare) throw new BranchOpError('not-found')
    const listId = await resolveListId(repo.owner, repo.slug)
    if (!listId) throw new BranchOpError('not-found')
    const branchTip = await exec('git', ['--git-dir', bare, 'rev-parse', '--verify', `refs/heads/${branch}`]).then(
      (r) => r.stdout.trim(),
      () => null,
    )
    if (!branchTip) throw new BranchOpError('not-found')
    return gitStore.withRepoLock(listId, async () => {
      const mainTip = (await exec('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/main'])).stdout.trim()
      if (mainTip === branchTip) throw new BranchOpError('nothing-to-merge')
      // Блоб resolved list.json (контент через stdin, не через argv) и дерево main —
      // независимы, читаем/пишем параллельно.
      const [hash, { stdout: lsTree }] = await Promise.all([
        execStdin(['--git-dir', bare, 'hash-object', '-w', '--stdin'], listJson.endsWith('\n') ? listJson : listJson + '\n'),
        exec('git', ['--git-dir', bare, 'ls-tree', 'main']),
      ])
      // Дерево = дерево main без steps/ и с новым list.json (md-оверрайды сбрасываются, канон — list.json).
      const entries = lsTree
        .split('\n')
        .filter(Boolean)
        .filter((l) => !l.endsWith('\tsteps') && !l.endsWith('\tlist.json'))
      entries.push(`100644 blob ${hash}\tlist.json`)
      const tree = await execStdin(['--git-dir', bare, 'mktree'], entries.join('\n') + '\n')
      const env = {
        ...process.env,
        GIT_AUTHOR_NAME: 'SetFork',
        GIT_AUTHOR_EMAIL: 'git@setfork.com',
        GIT_COMMITTER_NAME: 'SetFork',
        GIT_COMMITTER_EMAIL: 'git@setfork.com',
      }
      const { stdout: commit } = await exec(
        'git',
        ['--git-dir', bare, 'commit-tree', tree, '-p', 'main', '-p', `refs/heads/${branch}`, '-m', `Merge branch '${branch}' (resolved)`],
        { env },
      )
      const tipSha = commit.trim()
      await exec('git', ['--git-dir', bare, 'update-ref', 'refs/heads/main', tipSha])
      const newVersion = await gitStore.projectPushedCommit(listId, bare).catch(() => null)
      return { tipSha, newVersion, fastForward: false }
    })
  },

  async createTag(repo, name, version) {
    if (badBranch(name)) throw new BranchOpError('bad-name')
    const bare = await gitStore.ensureRepo(repo)
    if (!bare) throw new BranchOpError('not-found')
    // Коммит версии — по существующему тегу vN.
    const target = await exec('git', ['--git-dir', bare, 'rev-parse', '--verify', `refs/tags/v${version}`]).then(
      (r) => r.stdout.trim(),
      () => null,
    )
    if (!target) throw new BranchOpError('not-found')
    await exec('git', ['--git-dir', bare, 'tag', '-f', name, target]).catch(() => {
      throw new BranchOpError('internal')
    })
    return target
  },

  // Влить main в ветку — зеркало UpdateBranch в ядре (ours = ветка, theirs = main).
  async updateBranch(repo, name) {
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
    if (!(await tipOf(name))) throw new BranchOpError('not-found')
    // Тот же лок, что у merge/push: tip читаем ПОСЛЕ захвата (иначе конкурентный
    // пуш в ветку потерялся бы) — совпадает с Rust.
    return gitStore.withRepoLock(listId, async () => {
      const branchTip = await tipOf(name)
      const mainTip = await tipOf('main')
      if (!branchTip || !mainTip) throw new BranchOpError('not-found')
      // Ветка уже содержит main → обновлять нечего.
      const hasMain = await exec('git', ['--git-dir', bare, 'merge-base', '--is-ancestor', 'main', name]).then(() => true, () => false)
      if (hasMain) throw new BranchOpError('nothing-to-merge')
      // В ветке нет своих коммитов → просто двигаем ref на main.
      const branchIsAncestor = await exec('git', ['--git-dir', bare, 'merge-base', '--is-ancestor', name, 'main']).then(() => true, () => false)
      if (branchIsAncestor) {
        await exec('git', ['--git-dir', bare, 'update-ref', `refs/heads/${name}`, mainTip]).catch(() => {
          throw new BranchOpError('internal')
        })
        return { tipSha: mainTip, fastForward: true }
      }
      // ours = ветка, theirs = main — порядок обратный слиянию предложения.
      const merged = await mergeCommit(bare, name, 'main', "Merge branch 'main'")
      await exec('git', ['--git-dir', bare, 'update-ref', `refs/heads/${name}`, merged])
      return { tipSha: merged, fastForward: false }
    })
  },

  async listTags(repo) {
    const bare = await gitStore.ensureRepo(repo)
    if (!bare) return []
    const { stdout } = await exec('git', ['--git-dir', bare, 'for-each-ref', 'refs/tags', '--format=%(refname:short) %(objectname)']).catch(() => ({ stdout: '' }))
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [name, targetSha] = l.split(' ')
        return { name, targetSha }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  // Коммиты рефа за вычетом базы — зеркало git::history в Rust-ядре
  // (revwalk c hide(base) = `git log rev --not base`).
  async listCommits(repo, rev, opts) {
    if (badBranch(rev)) return null
    const notIn = opts?.notIn
    if (notIn && badBranch(notIn)) return null
    const bare = await gitStore.ensureRepo(repo)
    if (!bare) return null
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500)
    const args = ['--git-dir', bare, 'log', `--max-count=${limit}`, `--format=${GIT_LOG_FORMAT}%x01`, rev]
    if (notIn) args.push('--not', notIn)
    // Несуществующий реф — не ошибка: ветку могли удалить, вкладка покажет пусто.
    const res = await exec('git', args, { maxBuffer: 8 * 1024 * 1024 }).catch(() => null)
    return res ? parseGitLog(res.stdout) : null
  },
}

// git-команда с данными на stdin (hash-object/mktree).
function execStdin(args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, (err, stdout) => (err ? reject(err) : resolve(String(stdout).trim())))
    child.stdin!.end(input)
  })
}

// Пер-шаговые md-оверрайды: steps/NN-*.md с rev'а (зеркало Rust project.rs
// read_step_files). Ключ — NN из имени файла (номер шага в list.json),
// не позиция среди блоков.
async function stepMdOverrides(bare: string, rev: string): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  let names: string[]
  try {
    const { stdout } = await exec('git', ['--git-dir', bare, 'ls-tree', '--name-only', rev, 'steps/'])
    names = String(stdout)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.endsWith('.md'))
  } catch {
    return out // нет steps/ в дереве — оверрайдов нет
  }
  await Promise.all(
    names.map(async (path) => {
      const m = /^steps\/(\d+)/.exec(path)
      if (!m) return
      try {
        const { stdout } = await exec('git', ['--git-dir', bare, 'show', `${rev}:${path}`], {
          maxBuffer: 8 * 1024 * 1024,
        })
        out.set(Number(m[1]), String(stdout))
      } catch {
        /* нечитаемый блоб — просто без оверрайда */
      }
    }),
  )
  return out
}

// Значение front-matter вида `key: "json-строка"` или `key: raw` (порт Rust front_value).
function frontValue(raw: string): string {
  const t = raw.trim()
  if (t.startsWith('"')) {
    try {
      return JSON.parse(t) as string
    } catch {
      return t
    }
  }
  return t
}

// Обратный парс steps/NN-*.md → title/desc/command (порт Rust parse_step_md).
// Безопасное подмножество: источник остальных полей — всегда list.json.
function parseStepMd(content: string): { title?: string; desc?: string; command?: string } {
  let title: string | undefined
  let command: string | undefined
  const lines = content.split('\n')
  let bodyStart = 0
  if (lines[0] === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trimEnd() === '---') {
        bodyStart = i + 1
        break
      }
      if (lines[i].startsWith('title:')) title = frontValue(lines[i].slice('title:'.length))
      else if (lines[i].startsWith('command:')) command = frontValue(lines[i].slice('command:'.length))
    }
  }
  // desc — текст до первого маркера (**Why:**, subtask, ref), без пустых краёв.
  const descLines: string[] = []
  for (const line of lines.slice(bodyStart)) {
    const t = line.trimStart()
    if (t.startsWith('**Why:**') || t.startsWith('- [ ] ') || t.startsWith('- ')) break
    descLines.push(line)
  }
  while (descLines.length && !descLines[0].trim()) descLines.shift()
  while (descLines.length && !descLines[descLines.length - 1].trim()) descLines.pop()
  return { title, desc: descLines.length ? descLines.join('\n') : undefined, command }
}

// Материализация произвольного rev (ветка/sha): list.json → BranchSnapshot.
// Набор/порядок шагов — из list.json; per-step md-оверрайды (title/desc/command)
// применяются КАК В RUST-каноне (project.rs) — раньше inproc их игнорировал,
// и снапшот с оверрайдами зависел от флага SETFORK_CORE_URL (аудит core 2026-07-20, F4).
async function snapshotAt(bare: string, rev: string): Promise<BranchSnapshot | null> {
  let raw: string
  let tip: string
  try {
    ;[{ stdout: raw }, { stdout: tip }] = await Promise.all([
      exec('git', ['--git-dir', bare, 'show', `${rev}:list.json`], { maxBuffer: 8 * 1024 * 1024 }),
      exec('git', ['--git-dir', bare, 'rev-parse', rev]),
    ])
  } catch {
    return null
  }
  let parsed: {
    title?: string
    desc?: string
    tags?: string[]
    ordered?: boolean
    steps?: { n?: number; type?: string; content?: Record<string, unknown>; blockId?: string; title?: string; desc?: string; command?: string; level?: string; why?: string; section?: string; subtasks?: string[]; refs?: { label?: string; url?: string }[] }[]
  }
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const md = await stepMdOverrides(bare, rev)
  const isStep = (st: { type?: string }) => !st.type || st.type === 'step'
  // Шаг-блок без title — мусор; не-step блоки (text/image) валидны и без title.
  // origN — номер шага из list.json (ключ steps/NN-*.md), считается ДО фильтрации.
  const steps: BranchSnapshot['steps'] = (parsed.steps ?? [])
    .map((st, rawIdx) => ({ st, origN: st.n ?? rawIdx + 1 }))
    .filter(({ st }) => !isStep(st) || (st.title ?? '').trim())
    .map(({ st, origN }, i) => {
      const o = isStep(st) && md.has(origN) ? parseStepMd(md.get(origN)!) : undefined
      return {
        n: i + 1,
        // type/content несём только у не-step блоков (у шага — undefined, byte-compat).
        ...(isStep(st) ? {} : { type: st.type, content: st.content && typeof st.content === 'object' ? st.content : {} }),
        // Идентичность блока: с ней дифф ветки видит переименование как «изменён».
        blockId: st.blockId?.trim() ? st.blockId.trim() : null,
        title: o?.title?.trim() ? o.title : (st.title ?? ''),
        desc: o?.desc !== undefined ? o.desc : (st.desc ?? ''),
        command: o?.command !== undefined ? o.command : (st.command ?? ''),
        level: st.level || 'required',
        why: st.why ?? '',
        section: st.section ?? '',
        subtasks: st.subtasks ?? [],
        refs: (st.refs ?? [])
          .filter((r) => (r.label ?? '').trim())
          .map((r) => ({ label: r.label ?? '', ...(r.url ? { url: r.url } : {}) })),
      }
    })
  return {
    tipSha: tip.trim(),
    title: parsed.title ?? '',
    desc: parsed.desc ?? '',
    tags: parsed.tags ?? [],
    ordered: parsed.ordered ?? true,
    steps,
  }
}
