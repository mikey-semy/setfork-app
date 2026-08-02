import 'server-only'
import { Code, ConnectError, createClient } from '@connectrpc/connect'
import { coreTransport, mirrorPushTimeoutMs } from '@/shared/core-transport'
import type { GitCore, GitRepoRef } from '@/core'
import { BranchOpError } from '@/core'
import { GitCore as GitCoreService, type RepoRef } from '@/shared/gen/git_pb'
import { toWireContent } from './list-content'

// Единственная реализация GitCore: Connect-ES → Rust git-core по gRPC (h2c,
// plaintext); адрес — SETFORK_CORE_ADDR. Ядро резолвит/лочит/проецирует репо
// ВНУТРИ, здесь только маппинг форм порт ↔ proto-сообщения.
//
// NB: SETFORK_CORE_URL больше НЕ переключает git (развилки нет, см. core.ts), но
// переменная жива — по ней доменные сторы (collab-store, curation, library)
// решают, ходить ли в ядро за своей частью. Удалять её из compose нельзя.

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

  async receivePack(repo, body, opts) {
    const res = await client.receivePack({
      repo: toRepoRef(repo),
      body,
      gitProtocol: opts?.gitProtocol ?? '',
      lang: opts?.lang ?? '',
      actorHandle: opts?.actorHandle ?? '',
    })
    return {
      data: res.data,
      newVersion: toNewVersion(res.newVersion),
      magic: res.magic.map((m) => ({ base: m.base, branch: m.branch, tipSha: m.tipSha })),
    }
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

  async mergeBranch(repo, name, opts) {
    try {
      // Пустые строки = «как было»: старое ядро игнорирует неизвестный режим и
      // сливает по-обычному, а не падает.
      const res = await client.mergeBranch({
        repo: toRepoRef(repo),
        name,
        mode: opts?.mode ?? '',
        message: opts?.message ?? '',
      })
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

  async mergeResolved(repo, branch, content, opts) {
    try {
      // Способ слияния ядро теперь принимает и для резолвера (core #58): раньше
      // полей mode/message в MergeResolvedRequest не было, и здесь стоял явный
      // отказ — список, настроенный на squash, не мог быть разрешён вручную.
      const res = await client.mergeResolved({
        repo: toRepoRef(repo),
        branch,
        content: toWireContent(content),
        mode: opts?.mode ?? '',
        message: opts?.message ?? '',
      })
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

  async mirrorPush(repo) {
    // Дедлайн — точечный, не транспортный; почему именно так, см. рядом с
    // `mirrorPushTimeoutMs`. Для фонового подметальщика зависший вызов это не
    // «одна медленная задача», а смерть всей цепочки повторов: проход не доходит
    // до постановки преемника.
    const res = await client.mirrorPush(toRepoRef(repo), { timeoutMs: mirrorPushTimeoutMs() })
    return { ok: res.ok, error: res.error }
  },

  async updateBranch(repo, name) {
    try {
      const res = await client.updateBranch({ repo: toRepoRef(repo), name })
      return { tipSha: res.tipSha, fastForward: res.fastForward }
    } catch (e) {
      throw toBranchOpError(e)
    }
  },

  async commitToBranch(repo, branch, content, opts) {
    try {
      const res = await client.commitToBranch({
        repo: toRepoRef(repo),
        branch,
        content: toWireContent(content),
        message: opts?.message ?? '',
        expectedTip: opts?.expectedTip ?? '',
        authorName: opts?.author?.name ?? '',
        authorEmail: opts?.author?.email ?? '',
      })
      return { tipSha: res.tipSha, changed: res.changed }
    } catch (e) {
      throw toBranchOpError(e)
    }
  },

  async listTags(repo) {
    const res = await client.listTags(toRepoRef(repo)).catch(() => null)
    return res ? res.tags.map((t) => ({ name: t.name, targetSha: t.targetSha })) : []
  },

  async listCommits(repo, rev, opts) {
    const res = await client
      .listCommits({ repo: toRepoRef(repo), rev, notIn: opts?.notIn ?? '', limit: opts?.limit ?? 0 })
      .catch(() => null)
    if (!res || !res.found) return null
    return res.commits.map((c) => ({
      sha: c.sha,
      message: c.message.trim(),
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      // proto отдаёт секунды (int64 → bigint у protobuf-es).
      at: new Date(Number(c.atUnix) * 1000),
      parents: c.parents,
    }))
  },
}

// pb-снапшот → форма порта (общий маппинг branchSnapshot/mergeState).
function toSnapshot(res: {
  tipSha: string
  title: string
  desc: string
  tags: string[]
  ordered: boolean
  steps: { n: number; type: string; contentJson: string; blockId: string; title: string; desc: string; command: string; level: string; why: string; section: string; subtasks: string[]; refs: { label: string; url: string }[] }[]
}) {
  const parseContent = (json: string): Record<string, unknown> => {
    if (!json) return {}
    try {
      const o = JSON.parse(json)
      return o && typeof o === 'object' ? (o as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return {
    tipSha: res.tipSha,
    title: res.title,
    desc: res.desc,
    tags: res.tags,
    ordered: res.ordered,
    steps: res.steps.map((s) => ({
      n: s.n,
      // Блочная модель: type/content_json из ядра (R2); '' = шаг (поля опускаем).
      ...(s.type && s.type !== 'step' ? { type: s.type, content: parseContent(s.contentJson) } : {}),
      // '' в proto = «идентичности нет» (данные старше ADR-0013).
      blockId: s.blockId || null,
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

/**
 * Причина отказа ядра (трейлер `sf-reason`) → код порта.
 *
 * Раньше причину угадывали по ТЕКСТУ: `rawMessage.includes('conflict')`. Это
 * ломалось от любой правки сообщения и уже подвело — отказы, добавленные в ядре
 * позже (лишний путь в дереве, переполненный репозиторий, заморожен, в архиве),
 * не совпадали ни с одной подстрокой, и человек видел общую ошибку вместо
 * причины. AIP-193 про это прямо: клиент обязан смотреть на машиночитаемый
 * `reason`, потому что тексты содержат переменные куски.
 *
 * Ключи — контракт провода с ядром (`src/reason.rs`), значения — словарь порта.
 * Список сверяется скриптом ядра `check-proto-sync.sh`: причина, добавленная в
 * ядре и забытая здесь, роняет его локальный CI.
 */
const REASON_TO_CODE: Record<string, BranchOpError['code']> = {
  BAD_NAME: 'bad-name',
  EXISTS: 'exists',
  NOT_FOUND: 'not-found',
  PROTECTED: 'protected',
  CONFLICT: 'conflict',
  NOTHING_TO_MERGE: 'nothing-to-merge',
  STALE: 'stale',
  // Ядро отказало по формату дерева или размеру репозитория. Для порта это тот
  // же класс «правка не принята» — отдельного кода не заводим, пока UI не готов
  // показывать их по-разному.
  FOREIGN_PATH: 'protected',
  MISSING_LIST_JSON: 'protected',
  REPO_TOO_LARGE: 'protected',
  // Вердикт приложения: список заморожен или в архиве (ADR-0015).
  FROZEN: 'protected',
  ARCHIVED: 'protected',
  // Спросить приложение не удалось — писать нельзя, но это не вина правки.
  GATE_UNAVAILABLE: 'internal',
  RESERVED_TAG_NAME: 'bad-name',
}

// gRPC-статусы ядра → машиночитаемые коды порта.
function toBranchOpError(e: unknown): BranchOpError {
  if (!(e instanceof ConnectError)) return new BranchOpError('internal')

  // Причина из трейлера — основной путь. Connect-ES кладёт трейлеры gRPC в
  // metadata ошибки, поэтому это ровно то, что прислало ядро.
  const reason = e.metadata.get('sf-reason')
  if (reason && REASON_TO_CODE[reason]) return new BranchOpError(REASON_TO_CODE[reason])

  // Причины нет — значит ядро старее этой сборки (фронт выкатывается первым).
  // Раскладываем по gRPC-коду; подстроки НЕ разбираем: угадывание по тексту и
  // было проблемой. УБРАТЬ, когда ядро с sf-reason уедет на прод.
  if (e.code === Code.InvalidArgument) return new BranchOpError('bad-name')
  if (e.code === Code.AlreadyExists) return new BranchOpError('exists')
  if (e.code === Code.NotFound) return new BranchOpError('not-found')
  if (e.code === Code.FailedPrecondition) return new BranchOpError('protected')
  return new BranchOpError('internal')
}
