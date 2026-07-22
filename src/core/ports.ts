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
  NewStepInput,
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
  steps: NewStepInput[]
  authorId?: Id | null // кто создал версию (для «Коммитов»); опционально — gardener/фон могут не знать
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
  steps: NewStepInput[]
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
/** Уровень подписки на список (дропдаун Watch на GitHub). 'participating' —
 *  глобальный дефолт (только упоминания/участие) = отсутствие строки в watches. */
export type WatchLevel = 'participating' | 'all' | 'ignore' | 'custom'
/** События с доставкой наблюдателям (для level='custom'). */
export type WatchEvent = 'versions' | 'issues' | 'suggestions'
export type WatchEvents = Partial<Record<WatchEvent, boolean>>
export interface WatchState {
  level: WatchLevel
  events: WatchEvents | null
}

export interface CurationStore {
  isStarred(listId: Id, userId: Id): Promise<boolean>
  toggleStar(listId: Id, userId: Id): Promise<boolean> // → новое состояние (true = теперь со звездой)
  isWatching(listId: Id, userId: Id): Promise<boolean> // true, если level 'all'|'custom'
  /** Текущее состояние подписки зрителя (для дропдауна Watch). */
  watchState(listId: Id, userId: Id): Promise<WatchState>
  /** Явно задать уровень; 'participating' удаляет строку (= дефолт). events — для 'custom'. */
  setWatch(listId: Id, userId: Id, level: WatchLevel, events?: WatchEvents): Promise<void>
  toggleWatch(listId: Id, userId: Id): Promise<boolean> // быстрый тумблер participating↔all
  ensureWatch(listId: Id, userId: Id): Promise<void>
  watchCount(listId: Id): Promise<number> // подписчики: level 'all'|'custom' (без 'ignore')
  /** Кому слать событие: level='all' ИЛИ (level='custom' И events[event]). */
  watcherIds(listId: Id, event: WatchEvent): Promise<Id[]>
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
    // Блочная модель: не-step блоки несут type/content (у step — undefined).
    type?: string
    content?: Record<string, unknown>
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
  /** A2: создать ветку от базы (''=main). → tip sha; бросает BranchOpError. */
  createBranch(repo: GitRepoRef, name: string, from?: string): Promise<string>
  /** A2: удалить ветку (main защищён). Бросает BranchOpError. */
  deleteBranch(repo: GitRepoRef, name: string): Promise<void>
  /** A3: влить ветку в main (ff или merge-commit) + проекция новой версии.
   *  Конфликт/нечего вливать → BranchOpError('conflict'|'nothing-to-merge'). */
  mergeBranch(repo: GitRepoRef, name: string): Promise<MergeResult>
  /** A4: вход конфликтного merge — base (merge-base), ours (main), theirs (ветка).
   *  null — ветки/merge-base/материализаций нет. */
  mergeState(repo: GitRepoRef, branch: string): Promise<MergeState | null>
  /** A4: merge с ручным резолвом — финальный list.json (строка). Дерево =
   *  main c заменённым list.json без steps/ (md-оверрайды сбрасываются). */
  mergeResolved(repo: GitRepoRef, branch: string, listJson: string): Promise<MergeResult>
  /** Git-тег релиза на коммит версии (у версии уже есть тег vN). → sha коммита. */
  createTag(repo: GitRepoRef, name: string, version: number): Promise<string>
  /** Все git-теги репо (vN + релизные), по имени. */
  listTags(repo: GitRepoRef): Promise<GitTag[]>
}

export interface GitTag {
  name: string
  targetSha: string
}

export interface MergeResult {
  tipSha: string
  newVersion: number | null // спроецированная версия (null — list.json не менялся)
  fastForward: boolean
}

export interface MergeState {
  mergeBaseSha: string
  base: BranchSnapshot
  ours: BranchSnapshot // main
  theirs: BranchSnapshot // ветка
}

/** Ошибка операций над ветками с машиночитаемой причиной (для UI-сообщений). */
export class BranchOpError extends Error {
  constructor(public code: 'bad-name' | 'exists' | 'not-found' | 'protected' | 'conflict' | 'nothing-to-merge' | 'internal') {
    super(code)
    this.name = 'BranchOpError'
  }
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
