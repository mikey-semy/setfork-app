// Порты — контракты инфраструктуры, от которых зависит домен.
// Адаптеры (Drizzle, git, pgvector, OpenRouter) реализуют их; пост-MVP —
// реализация на Rust. Домен видит только эти интерфейсы. См. docs/architecture.md.
//
// Это КОНТРАКТ, а не финальный API: методы добавляются по мере того, как
// features/* мигрируют на порты (мягко, послойно).

import type {
  Contributor,
  Id,
  Issue,
  IssueComment,
  List,
  ListOrigin,
  ListStatus,
  LocaleText,
  NotificationType,
  Step,
  Suggestion,
  SuggestionComment,
  Version,
  Visibility,
} from './domain/entities'

// ── Утилиты (детерминизм/тестируемость) ──────────────────────────────
export interface Clock {
  now(): Date
}
export interface IdGen {
  uuid(): Id
}

// ── Списки / версии / шаги ───────────────────────────────────────────
export interface NewVersionInput {
  note: string
  steps: Omit<Step, 'id' | 'versionId'>[]
}

export interface CreateListInput {
  ownerId: Id
  slug: string
  title: LocaleText
  desc: LocaleText
  tags: string[]
  ordered: boolean
  visibility: Visibility
  status: ListStatus
  origin: ListOrigin
  forkedFromId?: Id | null
  note: string // заметка первой версии
  steps: Omit<Step, 'id' | 'versionId'>[]
}

export interface ListStore {
  getBySlug(owner: string, slug: string): Promise<List | null>
  listVersions(listId: Id): Promise<Version[]>
  getVersion(listId: Id, version: number): Promise<{ version: Version; steps: Step[] } | null>
  /** Создать список + первую версию + шаги. */
  create(input: CreateListInput): Promise<List>
  /** Создать новую версию (снимок). Двигает currentVersion. */
  addVersion(listId: Id, input: NewVersionInput): Promise<Version>
  getContributors(listId: Id): Promise<Contributor[]>
}

// ── Индекс поиска (обслуживание) ─────────────────────────────────────
// Чтение ленты — read-проекция (getFeed в library/queries), не порт.
// Здесь только МУТАЦИИ индекса (эмбеддинги pgvector).
export interface SearchIndex {
  /** Пересчитать эмбеддинг одного списка (или убрать из индекса, если списка нет). */
  reindex(listId: Id): Promise<void>
  /** Убрать из индекса осиротевшие (удалённые) списки. */
  purgeStale(activeRefIds?: Set<Id>): Promise<{ removed: number }>
}

// ── Курирование / соц. граф ──────────────────────────────────────────
export interface CurationStore {
  isStarred(listId: Id, userId: Id): Promise<boolean>
  toggleStar(listId: Id, userId: Id): Promise<boolean> // → новое состояние (true = теперь со звездой)
  isWatching(listId: Id, userId: Id): Promise<boolean>
  toggleWatch(listId: Id, userId: Id): Promise<boolean>
  ensureWatch(listId: Id, userId: Id): Promise<void>
  watchCount(listId: Id): Promise<number>
  watcherIds(listId: Id): Promise<Id[]>
}

// ── Issues / предложения / комментарии ───────────────────────────────
export interface CollabStore {
  openIssue(listId: Id, authorId: Id, title: string, body: string, labels: string[]): Promise<Issue>
  addIssueComment(issueId: Id, authorId: Id, body: string): Promise<IssueComment>
  setIssueStatus(issueId: Id, status: Issue['status']): Promise<void>
  createSuggestion(listId: Id, authorId: Id, note: string, steps: Suggestion['steps']): Promise<Suggestion>
  addSuggestionComment(suggestionId: Id, authorId: Id, body: string): Promise<SuggestionComment>
}

// ── Git (ключевой порт; пост-MVP → gix read / git2 write) ────────────
export interface GitRepoRef {
  owner: string
  slug: string
}
/** Непрозрачный хэндл материализованного репо (сейчас — путь на диске). */
export type RepoHandle = string
export interface GitStore {
  /** Гарантирует персистентный bare-репо, синхронный с историей версий. */
  ensureRepo(ref: GitRepoRef): Promise<RepoHandle | null>
  uploadPackAdvertise(repo: RepoHandle, gitProtocol?: string): Promise<Uint8Array>
  uploadPackRpc(repo: RepoHandle, body: Uint8Array, gitProtocol?: string): Promise<Uint8Array>
  receivePackAdvertise(repo: RepoHandle, gitProtocol?: string): Promise<Uint8Array>
  receivePackRpc(repo: RepoHandle, body: Uint8Array, gitProtocol?: string): Promise<Uint8Array>
  bundle(ref: GitRepoRef): Promise<Uint8Array | null>
  /** Сериализация push-критической секции (receive-pack + проекция) по списку. */
  withRepoLock<T>(listId: Id, fn: () => Promise<T>): Promise<T>
}

/** Проекция запушенного коммита в новую версию (git → домен). */
export interface GitProjection {
  projectPushedCommit(listId: Id, repo: RepoHandle): Promise<number | null>
}

// ── GitCore — высокоуровневый порт под ПРОВОД (Gitaly-стиль) ──────────
// Совпадает с proto/git.proto: сервис резолвит/лочит/проецирует репо ВНУТРИ.
// Реализации: inproc (поверх GitStore) сейчас; remote (Connect→Rust) в Фазе 2.
// Возвращает null, если репо недоступно; auth — на стороне вызывающего (BFF-роут).
export interface GitBranch {
  name: string
  tipSha: string
  isDefault: boolean // main
  ahead: number // коммитов впереди main
  behind: number
}

export interface BranchSnapshot {
  tipSha: string
  title: string
  desc: string
  tags: string[]
  ordered: boolean
  steps: {
    n: number
    title: string
    desc: string
    command: string
    level: string
    why: string
    section: string
    subtasks: string[]
    refs: { label: string; url?: string }[]
  }[]
}

export interface GitCore {
  infoRefsUploadPack(repo: GitRepoRef, gitProtocol?: string): Promise<Uint8Array | null>
  infoRefsReceivePack(repo: GitRepoRef, gitProtocol?: string): Promise<Uint8Array | null>
  uploadPack(repo: GitRepoRef, body: Uint8Array, gitProtocol?: string): Promise<Uint8Array | null>
  /** receive-pack + проекция в версию (атомарно под локом). newVersion — созданная версия. */
  receivePack(repo: GitRepoRef, body: Uint8Array, gitProtocol?: string): Promise<{ data: Uint8Array; newVersion: number | null } | null>
  bundle(repo: GitRepoRef): Promise<Uint8Array | null>
  /** Ветки (A1 read-only): main первым; прочие — черновики без проекции. */
  listBranches(repo: GitRepoRef): Promise<GitBranch[]>
  /** Материализация tip ветки (просмотр «на ветке»). null — ветки/list.json нет. */
  branchSnapshot(repo: GitRepoRef, branch: string): Promise<BranchSnapshot | null>
}

// ── AI (генерация/refine/эмбеддинги + учёт стоимости) ────────────────
export interface AiUsageMeta {
  userId: Id
  feature: string
  refType?: string
  refId?: Id
}
export interface AiPort {
  embed(text: string, meta: AiUsageMeta): Promise<number[] | null>
  // generateDraft/refine добавляются при миграции features/generation.
}

// ── Уведомления ──────────────────────────────────────────────────────
export interface NotifyInput {
  recipientId: Id
  actorId?: Id | null
  type: NotificationType
  listId?: Id | null
  issueId?: Id | null
}
export interface Notifier {
  notify(input: NotifyInput): Promise<void>
  notifyMany(recipientIds: Id[], input: Omit<NotifyInput, 'recipientId'>): Promise<void>
}

// ── Каталоги (repositories) ──────────────────────────────────────────
export interface CatalogStore {
  /** Создать каталог владельца (или вернуть существующий с тем же name). → id каталога. */
  ensure(ownerId: Id, name: string, title: LocaleText): Promise<Id | null>
  /** Привязать список к каталогу (или отвязать, catalogId=null). */
  setListCatalog(listId: Id, catalogId: Id | null): Promise<void>
  /** Удалить каталог владельца (списки становятся solo). */
  remove(catalogId: Id, ownerId: Id): Promise<void>
}
