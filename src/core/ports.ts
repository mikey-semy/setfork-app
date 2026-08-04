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
  Moderation,
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
  /** Патч меты списка (Ф2a-довесок): применяется ядром В ТОЙ ЖЕ транзакции, что
   *  и версия, ДО сборки канона — коммит сразу несёт свежие title/desc/tags/ordered.
   *  Отсутствующее поле = «не трогать». НЕ обновляйте мету отдельным запросом до
   *  addVersion: сбой RPC оставит мету записанной без версии. */
  meta?: {
    title?: LocaleText
    desc?: LocaleText
    tags?: string[]
    ordered?: boolean
  }
  /** Версия, НА КОТОРОЙ основана правка (то, что писавший читал). Ядро сверяет её
   *  с текущей ВНУТРИ транзакции, где строка списка уже взята `for update`, и при
   *  расхождении отказывает — правка, готовившаяся на устаревшем снимке, не
   *  вытеснит чужую. Проверять это в приложении бесполезно: между проверкой и
   *  вызовом есть окно. Не задано — прежнее поведение (последняя запись побеждает). */
  expectedVersion?: number
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
  /** Состояние публикации новой строки. Его НЕ задают вызывающие: фасад listStore
   *  считает его сам (`initialModeration`) и подставляет перед записью — иначе
   *  правило премодерации жило бы в семи точках создания списка и одна из них
   *  рано или поздно пустила бы непроверенное в паблик.
   *  Не задано = 'active' (ядро трактует пустое поле так же). */
  moderation?: Moderation
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

/** Блок версии списка: шаг или презентационный блок. Одна форма на чтение
 *  (снимок ветки) и на запись (содержимое, из которого ядро соберёт list.json) —
 *  раньше она была объявлена дважды и могла разъехаться. */
export interface ListBlock {
  n: number
  // Блочная модель: не-step блоки несут type/content (у step — undefined).
  type?: string
  content?: Record<string, unknown>
  /** Стабильная идентичность блока из list.json (ADR-0013); null — её там нет. */
  blockId?: string | null
  title: string
  desc: string
  command: string
  level: string
  why: string
  section: string
  subtasks: string[]
  refs: { label: string; url?: string }[]
}

export interface BranchSnapshot {
  tipSha: string
  title: string
  desc: string
  tags: string[]
  ordered: boolean
  steps: ListBlock[]
}

/** Содержимое версии списка для ЗАПИСИ. Канонический `list.json` из него собирает
 *  ЯДРО — единственный владелец формата. Клиент формат не сериализует: иначе
 *  правила живут в двух реализациях и расходятся (см. HQ tracks/git-format.md). */
export interface ListContent {
  title: string
  desc: string
  tags: string[]
  ordered: boolean
  /** Номер версии, который попадёт в list.json. */
  version: number
  steps: ListBlock[]
}

export interface GitCore {
  infoRefsUploadPack(repo: GitRepoRef, gitProtocol?: string): Promise<Uint8Array | null>
  infoRefsReceivePack(repo: GitRepoRef, gitProtocol?: string): Promise<Uint8Array | null>
  uploadPack(repo: GitRepoRef, body: Uint8Array, gitProtocol?: string): Promise<Uint8Array | null>
  /** receive-pack + проекция в версию (атомарно под локом). newVersion — созданная версия. */
  /** Приём пуша. `lang` — язык ЧЕЛОВЕКА для отказов pre-receive: их он читает
   *  прямо в выводе `git push`, переводить некому (И2). '' → английский.
   *  `actorId` (Ф4) — НЕИЗМЕННЫЙ идентификатор автора: по нему ядро называет
   *  ветку правки. Не ник: ник сменяем и достаётся другому, а имя ветки живёт
   *  вечно (у Gerrit и GitHub ветки вклада по той же причине не именуются ником).
   *  `actorRole` (Ф5) — уже принятое решение о правах: ядро исполняет по нему
   *  правило пространства (посторонний пушит ТОЛЬКО `refs/for/main`, именованных
   *  веток ему не положено вовсе). Судит ядро по белому списку: `owner` и
   *  `collaborator` пишут куда угодно, ВСЁ ОСТАЛЬНОЕ непустое ограничивается —
   *  опечатка или незнакомая роль обязаны закрывать дверь, а не открывать.
   *  '' — отдельный знакомый случай: фронт старше Ф5, ролей не шлёт и посторонних
   *  не впускает; ядро не ограничивает, но пишет об этом в лог. */
  receivePack(
    repo: GitRepoRef,
    body: Uint8Array,
    opts?: {
      gitProtocol?: string
      lang?: string
      actorId?: string
      /** ПЕРЕХОДНОЕ: ник для СТАРОГО ядра (до Ф5) — оно называет ветку правки по
       *  нему и без него отвергает `refs/for/main` всё время выкатки. Новое ядро
       *  поле игнорирует. Убрать, когда ядро с Ф5 везде (трек git-surface). */
      actorHandle?: string
      actorRole?: 'owner' | 'collaborator' | 'contributor'
    },
  ): Promise<{ data: Uint8Array; newVersion: number | null; magic: MagicPush[] } | null>
  bundle(repo: GitRepoRef): Promise<Uint8Array | null>
  /** Ветки (A1 read-only): main первым; прочие — черновики без проекции. */
  listBranches(repo: GitRepoRef): Promise<GitBranch[]>
  /** Материализация tip ветки (просмотр «на ветке»). null — ветки/list.json нет. */
  branchSnapshot(repo: GitRepoRef, branch: string): Promise<BranchSnapshot | null>
  /** A2: создать ветку от базы (''=main). → tip sha; бросает BranchOpError. */
  createBranch(repo: GitRepoRef, name: string, from?: string): Promise<string>
  /** A2: удалить ветку (main защищён). Бросает BranchOpError. */
  deleteBranch(repo: GitRepoRef, name: string): Promise<void>
  /** A3: влить ветку в main (ff, merge-commit или squash) + проекция новой версии.
   *  Конфликт/нечего вливать → BranchOpError('conflict'|'nothing-to-merge'). */
  mergeBranch(repo: GitRepoRef, name: string, opts?: MergeOptions): Promise<MergeResult>
  /** A4: вход конфликтного merge — base (merge-base), ours (main), theirs (ветка).
   *  null — ветки/merge-base/материализаций нет. */
  mergeState(repo: GitRepoRef, branch: string): Promise<MergeState | null>
  /** A4: merge с ручным резолвом — разрешённое СОДЕРЖИМОЕ (канон соберёт ядро).
   *  Дерево = main c заменённым list.json без steps/ (md-оверрайды сбрасываются). */
  mergeResolved(repo: GitRepoRef, branch: string, content: ListContent, opts?: MergeOptions): Promise<MergeResult>
  /** Git-тег релиза на коммит версии (у версии уже есть тег vN). → sha коммита. */
  createTag(repo: GitRepoRef, name: string, version: number): Promise<string>
  /** Ф3: пуш зеркала сейчас. Исход в теле (текст ошибки — владельцу в статус),
   *  не исключением: ошибка сети форджи — легитимный ответ. */
  mirrorPush(repo: GitRepoRef): Promise<{ ok: boolean; error: string }>
  /** Ф2: проверить доступ к зеркалу БЕЗ пуша — «Проверить доступ» в настройках.
   *  Ядро идёт `git push --dry-run`: аутентифицируется на пути ЗАПИСИ и ничего
   *  не отправляет. Проверять чтением (`ls-remote`) нельзя — оно отвечает
   *  успехом даже на мусорный токен, то есть обещало бы доступ, которого нет. */
  mirrorCheck(repo: GitRepoRef): Promise<{ ok: boolean; error: string }>
  /** Ф5: что умеет ЭТО ядро.
   *
   *  Фронт и ядро выкатываются порознь, а правило «посторонний пишет только в
   *  своё пространство» исполняет ядро. Поэтому фронт СПРАШИВАЕТ, умеет ли ядро
   *  это правило, а не полагается на порядок выкатки: порядок можно перепутать, а
   *  ядро — откатить назад, оставив фронт новым (авто-ревью core#80).
   *
   *  Молчание = «не умею»: старое ядро на неизвестный метод отвечает
   *  UNIMPLEMENTED, и это ответ по существу, а не сбой связи. Та же форма, что у
   *  самого git: сервер объявляет возможности, клиент пользуется объявленным.
  *
   *  Ответ НЕ кэшируется вызывающим: право, запомненное про запас, действует
   *  дольше основания — откат ядра назад отменял бы правило, а фронт продолжал
   *  бы пускать. `timeoutMs` обязателен по той же причине: зависшее ядро должно
   *  давать честный отказ, а не бесконечное ожидание. */
  capabilities(opts?: { timeoutMs?: number }): Promise<{ enforcesPushRoles: boolean }>
  /** A5: влить main в ветку (обратное слияние). main не двигается → версии нет.
   *  Бросает BranchOpError('conflict'|'nothing-to-merge'|'not-found'). */
  updateBranch(repo: GitRepoRef, name: string): Promise<{ tipSha: string; fastForward: boolean }>
  /** Все git-теги репо (vN + релизные), по имени. */
  listTags(repo: GitRepoRef): Promise<GitTag[]>
  /** Коммиты рефа, свежие первыми. `notIn` (обычно 'main') скрывает достижимое
   *  из базы — остаётся ровно вклад ветки. null — рефа нет (ветку удалили). */
  listCommits(repo: GitRepoRef, rev: string, opts?: { notIn?: string; limit?: number }): Promise<GitCommit[] | null>
  /** Записать содержимое версии в ВЕТКУ одним коммитом (правка предложения,
   *  «применить предложенную правку»). Канон собирает ядро; main не двигается →
   *  версии нет.
   *  `expectedTip` — оптимистичная блокировка: не совпал → BranchOpError('stale').
   *  `changed:false` — содержимое совпало, коммита не было. */
  commitToBranch(
    repo: GitRepoRef,
    branch: string,
    content: ListContent,
    opts?: { message?: string; expectedTip?: string; author?: { name: string; email: string } },
  ): Promise<{ tipSha: string; changed: boolean }>
}

export interface GitCommit {
  sha: string
  /** Полное сообщение; первая строка — заголовок. */
  message: string
  authorName: string
  authorEmail: string
  at: Date
  /** 2 и больше — merge-коммит. */
  parents: number
}

export interface GitTag {
  name: string
  targetSha: string
}

/**
 * Как вливать ветку.
 *
 * `merge` — как было: fast-forward, если можно, иначе merge-коммит с двумя родителями.
 * `squash` — ОДИН коммит с одним родителем: в main не уезжает промежуточная история
 * ветки, а вклад авторов сохраняется трейлерами `Co-authored-by`. Fast-forward при
 * squash не применяется намеренно: он затащил бы ровно ту историю, ради отсутствия
 * которой squash и выбирают.
 */
export interface MergeOptions {
  mode?: 'merge' | 'squash'
  /** Заголовок squash-коммита; пусто → «Squashed branch <name>». Для merge не используется. */
  message?: string
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
/** Ф4: что сделал магический пуш `refs/for/<base>` — ядро положило коммиты в
 *  ветку автора, предложение из этого делает приложение. */
export interface MagicPush {
  base: string
  branch: string
  tipSha: string
}

/** Запись версии отклонена ядром по предусловию.
 *  'stale' — правка основана не на текущей версии (её готовили, пока список ушёл
 *  вперёд). Не сбой: писавший перечитывает список и накладывает правку заново. */
export class ListWriteError extends Error {
  constructor(public code: 'stale') {
    super(`list write rejected: ${code}`)
    this.name = 'ListWriteError'
  }
}

export class BranchOpError extends Error {
  constructor(
    public code:
      | 'bad-name'
      | 'exists'
      | 'not-found'
      | 'protected'
      | 'conflict'
      | 'nothing-to-merge'
      // Ветку подвинули с момента чтения — писать поверх нельзя (см. commitToBranch).
      | 'stale'
      | 'internal',
  ) {
    super(code)
    this.name = 'BranchOpError'
  }
}

/**
 * Отказ smart-HTTP операции git на пути к ядру.
 *
 * У ветковых операций типизированный отказ был давно (`BranchOpError`), а четыре
 * операции самого протокола его не имели: порт объявлял nullable-ответ, роут писал
 * `if (!body) return 500`, но адаптер в этой ветке ничего не возвращал — он бросал
 * `ConnectError`. То есть недоступное ядро, дедлайн и любая другая авария уходили
 * в общий 500 фреймворка: git-клиент получал HTML вместо понятного отказа, а в
 * наблюдаемость не попадало ни операции, ни репозитория.
 */
export class GitTransportError extends Error {
  constructor(
    public code:
      /** Ядро не отвечает или соединение отвергнуто — временно, повтор осмыслен. */
      | 'unavailable'
      /** Истёк дедлайн: у большого пуша это норма жизни, а не поломка клиента. */
      | 'timeout'
      /** Ядро не знает такого репозитория (рассинхрон с базой). */
      | 'not-found'
      /** Всё остальное: ответ ядра не разобран или пришла неожиданная ошибка. */
      | 'internal',
    /** Операция протокола — чтобы в логе было видно, что именно упало. */
    public op: string,
    options?: { cause?: unknown },
  ) {
    super(`git ${op}: ${code}`, options)
    this.name = 'GitTransportError'
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
