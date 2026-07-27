// Доменные сущности SetFork — чистые типы (ubiquitous language).
// НИЧЕГО не импортируем из features/shared/app/Drizzle/Next — это ядро,
// которое пост-MVP переносится на Rust как есть (см. docs/architecture.md).

// ── Примитивы ────────────────────────────────────────────────────────
/** Локализованный текст: код языка → строка (например { en, ru }).
 *  Совместимо с `@/shared/i18n` LocaleText (Partial<Record<string,string>>). */
export type LocaleText = Partial<Record<string, string>>

export type Id = string // uuid; при желании позже сделать branded-типы

export type StepLevel = 'required' | 'recommended' | 'optional'
export type ListStatus = 'draft' | 'published'
export type Visibility = 'public' | 'private'
export type Moderation = 'active' | 'pending' | 'flagged' | 'hidden'
export type ListOrigin = 'authored' | 'forked' | 'ai_draft'
export type SuggestionStatus = 'open' | 'accepted' | 'rejected'
export type IssueStatus = 'open' | 'closed'

// ── Пользователь ─────────────────────────────────────────────────────
export interface User {
  id: Id
  handle: string
  name: string | null
  avatarRef: string | null // сырой storage_key / url (резолвится в адаптере медиа)
  bio: string | null
  createdAt: Date
}

// ── Repository (git-единица; держит 1..N List) ───────────────────────
// Сейчас — логический аггрегат: у каждого List свой solo-Repository.
// Таблица появится вместе с UI каталогов (см. docs/architecture.md).
export interface Repository {
  id: Id
  ownerId: Id
  /** slug каталога; для solo-repo совпадает со слагом единственного списка. */
  name: string
  listIds: Id[]
}

// ── List (единица контента и курирования) ────────────────────────────
export interface List {
  id: Id
  repositoryId: Id // логический; путь внутри репо = lists/<slug>
  ownerId: Id
  slug: string
  title: LocaleText
  desc: LocaleText
  tags: string[]
  ordered: boolean
  status: ListStatus
  visibility: Visibility
  moderation: Moderation
  moderationReason: string | null
  verified: boolean
  pinned: boolean
  origin: ListOrigin
  forkedFromId: Id | null
  currentVersion: number
  starsCount: number
  forksCount: number
  runsCount: number
  createdAt: Date
  updatedAt: Date
}

// ── Version (снимок = git-коммит + тег vN) ───────────────────────────
export interface Version {
  id: Id
  listId: Id
  version: number
  note: string
  /** SHA коммита в git-репо, если известен (пуш/материализация). */
  commitSha: string | null
  createdAt: Date
}

export interface StepRef {
  label: LocaleText
  url?: string
}

export interface Step {
  id: Id
  versionId: Id
  n: number
  // Блочная модель: 'step' (дефолт, runnable/чекаемый) | 'text' | 'image'.
  // content — payload не-step блоков (см. features/library/blocks.ts); для шага {}.
  type: string
  content: Record<string, unknown>
  title: LocaleText
  desc: LocaleText
  command: string
  level: StepLevel
  why: LocaleText
  // «ЗДЕСЬ НУЖЕН ЧЕЛОВЕК»: пункт зависит от того, чего модель знать не может — местные
  // цены и наличие, вкус, время на конкретном оборудовании, региональные правила. Не
  // дефект, а приглашение: реальность доступна человеку. Опционально — старые данные
  // и записи мимо редактора пометки не несут.
  // ⚠️ ДОЛГ КАТОВЕРА: в Rust-домене (setfork-core) этих полей ещё нет, поэтому при
  // SETFORK_DOMAIN_WRITES=1 пометка потеряется на записи. В git тоже не сериализуется
  // (golden-паритет list.json). Зеркалить в core — отдельный этап.
  needsHuman?: boolean
  needsHumanAsk?: LocaleText
  section: LocaleText // заголовок секции-группы ('' — без секции)
  subtasks: LocaleText[]
  refs: StepRef[]
  imageRef: string | null
}

/** Вход шага на ЗАПИСИ: type/content опциональны — хранилище дефолтит их
 *  в 'step'/{}. На чтении (Step) они всегда заполнены. */
export type NewStepInput = Omit<Step, 'id' | 'versionId' | 'type' | 'content'> & {
  type?: string
  content?: Record<string, unknown>
  /** Стабильный id блока СКВОЗЬ версии (steps.block_id). Пусто — идентичность
   *  неизвестна (старые данные или запись мимо редактора): дифф падает на
   *  сопоставление по заголовку. */
  blockId?: string | null
}

// ── Коллаборация ─────────────────────────────────────────────────────
export interface Issue {
  id: Id
  listId: Id
  number: number
  authorId: Id
  title: string
  body: string
  status: IssueStatus
  labels: string[]
  createdAt: Date
  updatedAt: Date
  closedAt: Date | null
}

export interface IssueComment {
  id: Id
  issueId: Id
  authorId: Id
  body: string
  createdAt: Date
}

/** Предложение правки (PR-аналог). */
export interface Suggestion {
  id: Id
  listId: Id
  authorId: Id
  status: SuggestionStatus
  note: string
  baseVersion: number
  /** снимок предложенных шагов/блоков (в БД — jsonb); type/content опциональны */
  steps: NewStepInput[]
  createdAt: Date
  resolvedAt: Date | null
}

export interface SuggestionComment {
  id: Id
  suggestionId: Id
  authorId: Id
  body: string
  createdAt: Date
}

// ── Курирование / соц. граф ──────────────────────────────────────────
export interface Star {
  userId: Id
  listId: Id
  createdAt: Date
}
export interface Watch {
  userId: Id
  listId: Id
  createdAt: Date
}
export interface Follow {
  followerId: Id
  followeeId: Id
  createdAt: Date
}
export interface Contributor {
  handle: string
  avatarRef: string | null
  accepted: number
}

// ── Уведомления / токены ─────────────────────────────────────────────
export type NotificationType =
  | 'suggestion_new'
  | 'suggestion_accepted'
  | 'suggestion_rejected'
  | 'suggestion_comment'
  | 'issue_new'
  | 'issue_comment'
  | 'new_version'
  | 'star'
  | 'fork'
  | 'follow'

export interface Notification {
  id: Id
  recipientId: Id
  actorId: Id | null
  type: NotificationType
  listId: Id | null
  issueId: Id | null
  read: boolean
  createdAt: Date
}

export interface ApiToken {
  id: Id
  userId: Id
  name: string
  prefix: string
  lastUsedAt: Date | null
  createdAt: Date
}
