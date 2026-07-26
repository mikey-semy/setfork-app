// Схема БД SetFork (MVP списков).
//
// Ядро ценности: шаблон (template) — это упорядоченная последовательность шагов,
// у него есть версии; прогон (run) — исполняемый экземпляр шаблона, привязанный
// к конкретной версии, хранит состояние по каждому шагу. Форк создаёт новый
// шаблон со ссылкой forked_from.
//
// Осознанно НЕ в v0: AI-генерация, community-trust, PR/merge, права/биллинг.

import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  primaryKey,
  pgTable,
  smallint,
  halfvec,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'
import type { Lang, LocaleText } from '../i18n'

// ── Enums ────────────────────────────────────────────────────────────
export const templateOrigin = pgEnum('template_origin', ['authored', 'forked', 'ai_draft'])
export const listVisibility = pgEnum('list_visibility', ['public', 'private'])
// draft — черновик (не опубликован, виден только владельцу); published — опубликован (виден по visibility).
export const listStatus = pgEnum('list_status', ['draft', 'published'])
// active — норма; pending — ждёт авто-проверку публикации (виден только владельцу);
// flagged — на проверку (репорт/ИИ); hidden — скрыт админом (не публичен).
export const moderationStatus = pgEnum('moderation_status', ['active', 'pending', 'flagged', 'hidden'])
export const runStatus = pgEnum('run_status', ['active', 'done', 'abandoned', 'failed'])
// Статус генерации. 'clarify' — совет прервался ради уточняющих вопросов: джоба завершена, но кандидата нет.
export const generationStatus = pgEnum('generation_status', ['pending', 'done', 'failed', 'clarify'])
export const stepStatus = pgEnum('step_status', ['todo', 'cur', 'done', 'blocked'])
// Уровень важности шага (как в стандартах: MUST / SHOULD / MAY).
export const stepLevel = pgEnum('step_level', ['required', 'recommended', 'optional'])
export const suggestionStatus = pgEnum('suggestion_status', ['open', 'accepted', 'rejected'])
// Тип AI-вызова для учёта расхода (токены/деньги).
export const aiFeature = pgEnum('ai_feature', ['generate', 'regenerate', 'refine', 'note', 'moderate', 'embed', 'translate', 'mcp-gnome', 'dig', 'assist'])
export const notificationType = pgEnum('notification_type', [
  'suggestion_new',
  'suggestion_accepted',
  'suggestion_rejected',
  'suggestion_comment',
  'issue_new',
  'issue_comment',
  'new_version',
  'star',
  'fork',
  'follow',
  'mention',
  'assigned',
  'transfer_incoming', // тебе предлагают принять владение списком
  'transfer_accepted', // получатель принял твою передачу
  'transfer_declined', // получатель отклонил твою передачу
])

export const issueStatus = pgEnum('issue_status', ['open', 'closed'])

// Обратная связь с сайта: категория и статус обработки админом.
export const feedbackCategory = pgEnum('feedback_category', ['bug', 'idea', 'content', 'legal', 'other'])
export const feedbackStatus = pgEnum('feedback_status', ['new', 'seen', 'done'])
// Жалобы на контент (DSA notice-and-action / DMCA-интейк).
export const reportReason = pgEnum('report_reason', ['illegal', 'spam', 'copyright', 'privacy', 'other'])
export const reportStatus = pgEnum('report_status', ['new', 'reviewed', 'actioned', 'dismissed'])

// Предложенный пункт (снимок правки внутри suggestion).
export type StepLevel = 'required' | 'recommended' | 'optional'
export type ProposedItem = {
  // Блочная модель: 'step' (дефолт, undefined тоже = шаг) | 'text' | 'image'.
  // content — payload не-step блоков (text:{md}, image:{ref,caption}); шагу не нужен.
  type?: string
  content?: Record<string, unknown>
  /** Стабильный id блока сквозь версии (steps.block_id); пусто — старые данные. */
  blockId?: string
  title: LocaleText
  desc: LocaleText
  command: string
  hasImage: boolean
  imageKey?: string // storage_key скриншота в S3 (если есть)
  level: StepLevel
  why: LocaleText // «зачем/почему» — обоснование шага
  section: LocaleText // заголовок секции-группы (пусто — без секции)
  subtasks: LocaleText[]
  refs: { label: LocaleText; url?: string }[]
}

// ── Users ────────────────────────────────────────────────────────────
// handle = публичный идентификатор в модели owner/name (как в дизайне: acme/deploy-to-vps).
export type Social = { type: string; url: string } // type: github | x | telegram | youtube | linkedin | site …

// Предпочтения уведомлений. Отсутствие ключа = включено (opt-out).
export type NotifyPrefs = {
  newSuggestions?: boolean
  suggestionResolved?: boolean
  stars?: boolean
  forks?: boolean
  issues?: boolean // новый issue на моём списке
  comments?: boolean // комментарии в issue/правке, где я участвую
  watchedUpdates?: boolean // новая версия отслеживаемого списка
  email?: boolean // дублировать уведомления на почту (по умолчанию выкл)
  browser?: boolean // показывать браузерные уведомления (по умолчанию выкл)
}

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  githubId: bigint('github_id', { mode: 'number' }).unique(), // null для demo-пользователя и ghost
  yandexId: text('yandex_id').unique(), // Яндекс OAuth: id из login.yandex.ru/info (строка по докам), null = не привязан
  vkId: bigint('vk_id', { mode: 'number' }).unique(), // VK ID OAuth: user_id, null = не привязан
  telegramId: bigint('telegram_id', { mode: 'number' }).unique(), // Telegram (бот-логин): tg user id, null = не привязан
  email: text('email').unique(), // вход по паролю (null у github/demo/ghost)
  passwordHash: text('password_hash'), // scrypt-хеш (null у oauth)
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }), // null = не подтверждена
  totpSecret: text('totp_secret'), // AES-256-GCM(base32-секрет), см. shared/auth/totp
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  totpLastStep: integer('totp_last_step'), // последний использованный TOTP-шаг (anti-replay): код с step ≤ этого отвергается
  uiAccent: text('ui_accent'), // Appearance: акцентный пресет ('' / null = синий), синхрон между устройствами
  uiFont: text('ui_font'), // Appearance: шрифт интерфейса ('' / null = Hanken Grotesk)
  handle: text('handle').notNull().unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  // Форма аватара в профиле: пользователь выбирает круг или квадрат (по умолчанию круг).
  avatarShape: text('avatar_shape').notNull().default('circle').$type<'circle' | 'square'>(),
  bio: text('bio'),
  location: text('location'),
  website: text('website'),
  socials: jsonb('socials').notNull().default([]).$type<Social[]>(),
  notifyPrefs: jsonb('notify_prefs').notNull().default({}).$type<NotifyPrefs>(),
  // Язык ДОСТАВКИ (email/push-уведомления) — интерфейс пока English-only.
  lang: text('lang').notNull().default('en').$type<Lang>(),
  deleted: boolean('deleted').notNull().default(false), // true у ghost / удалённых аккаунтов
  // Приватный профиль: страница /handle скрыта от всех кроме владельца, юзер убран
  // из поиска людей. Публичные СПИСКИ остаются публичными (со своим ником) — это не
  // анонимизация, а скрытие профиль-страницы/агрегатов. NB: списки прячет своя visibility.
  profilePrivate: boolean('profile_private').notNull().default(false),
  // Кураторский аккаунт библиотеки: правки садовника на его списках автопринимаются.
  curated: boolean('curated').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Telegram bot-login (одноразовые токены deep-link входа) ──────────
// Виджет oauth.telegram.org в РФ заблокирован, поэтому вход через бота:
// браузер получает токен (кука + t.me-ссылка), пользователь подтверждает в
// боте, webhook заполняет tg_*, браузер поллит и получает сессию.
export const telegramLoginTokens = pgTable('telegram_login_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  token: text('token').notNull().unique(), // hex из randomBytes; живёт 10 минут
  tgId: bigint('tg_id', { mode: 'number' }), // null до подтверждения в боте
  tgName: text('tg_name'),
  tgUsername: text('tg_username'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Topics (темы/домены с цветом — сайдбар Explore) ──────────────────
export const topics = pgTable('topics', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  label: jsonb('label').notNull().$type<LocaleText>(),
  color: text('color').notNull(), // hex, напр. #2563eb
})

// ── Tag registry (курируемый реестр тегов) ───────────────────────────
// Источник правды для автокомплита, курирования и админ-CRUD (переименование/
// слияние/удаление). templates.tags остаётся text[] слагов — реестр хранит
// метаданные тега по этому slug'у. usageCount — денормализованный счётчик
// публичных списков с тегом (обновляется при правках/фоновой пересборке).
export const tags = pgTable('tags', {
  slug: text('slug').primaryKey(), // нормализованный тег (как в templates.tags: lowercase, a-z0-9а-яё-)
  label: text('label'), // необязательное отображаемое имя (для курируемых); null → показываем slug
  description: text('description'), // необязательное описание для страницы тега
  curated: boolean('curated').notNull().default(false), // официальный/курируемый тег
  usageCount: integer('usage_count').notNull().default(0), // публичных активных списков с тегом
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Templates (список) ─────────────────────────────────────────────
export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: jsonb('title').notNull().$type<LocaleText>(),
    desc: jsonb('desc').notNull().default({}).$type<LocaleText>(),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    currentVersion: integer('current_version').notNull().default(1),
    origin: templateOrigin('origin').notNull().default('authored'),
    status: listStatus('status').notNull().default('published'),
    // true — упорядоченный (шаги 1..N); false — набор/список (порядок неважен).
    ordered: boolean('ordered').notNull().default(true),
    // true — курс с последовательным доступом: следующий урок открывается только
    // после сдачи тестов предыдущего (quiz-gate).
    gated: boolean('gated').notNull().default(false),
    // Опциональные разделы совместной работы («Features», как в настройках репо
    // GitHub): владелец может выключить Issues/Discussions на списке. Suggestions
    // (≈ PR) — ядро fork-модели, не отключаются. default true — старые списки как есть.
    issuesEnabled: boolean('issues_enabled').notNull().default(true),
    discussionsEnabled: boolean('discussions_enabled').notNull().default(true),
    visibility: listVisibility('visibility').notNull().default('public'),
    moderation: moderationStatus('moderation').notNull().default('active'),
    moderationReason: text('moderation_reason'),
    // Приоритет очереди модерации: 3 — тяжёлые категории/повторная заливка, 2 — прочие
    // нарушения/спам-эвристика, 1 — «ИИ не уверен», 0 — норма.
    moderationSeverity: smallint('moderation_severity').notNull().default(0),
    // Нормализованный sha256 контента — ловля повторной заливки удалённого.
    contentFingerprint: text('content_fingerprint'),
    appealedAt: timestamp('appealed_at', { withTimezone: true }), // апелляция владельца flagged-списка
    verified: boolean('verified').notNull().default(false),
    pinned: boolean('pinned').notNull().default(false), // закреплён владельцем на профиле
    isTemplate: boolean('is_template').notNull().default(false), // «Use this template» (копия без fork-связи)
    coverImage: text('cover_image'), // storage_key обложки-баннера (витрина/og); null → авто-баннер
    accent: text('accent'), // hex акцента карточки/авто-баннера ('' / null = дефолт)
    // Тип списка (ADR-0010): переносится из generations при принятии кандидата,
    // лениво доклассифицируется садовником. null = ещё не определён (≈procedure).
    listKind: text('list_kind'),
    repositoryId: uuid('repository_id'), // каталог-репозиторий (FK задаётся в relations); null = solo
    forkedFromId: uuid('forked_from_id'), // самоссылка задаётся в relations
    runsCount: integer('runs_count').notNull().default(0),
    forksCount: integer('forks_count').notNull().default(0),
    starsCount: integer('stars_count').notNull().default(0),
    // Когда рудник знаний (features/knowledge) последний раз добывал тройки из списка.
    // Ставится НЕЗАВИСИМО от урожая (фикс по ревью: «пустые» списки перерабатывались
    // ежедневно впустую). NULL = ещё не добывали.
    triplesMinedAt: timestamp('triples_mined_at', { withTimezone: true }),
    // Сумма уникальных дневных просмотров (см. template_views); владелец не считается.
    viewsCount: integer('views_count').notNull().default(0),
    // Обратимые ограниченные состояния владельца (Danger Zone; НЕ путать с moderation —
    // то админский takedown). archivedAt — полностью read-only (как archived-репо GitHub:
    // ни правок, ни предложений, ни новых прогонов; просмотр/форк/звезда работают).
    // frozenAt — заморозка правок: нельзя править/предлагать, но прогоны и просмотр идут.
    // null = состояние выключено. archived строже frozen.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    frozenAt: timestamp('frozen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerSlug: uniqueIndex('templates_owner_slug').on(t.ownerId, t.slug),
    forkedFrom: index('templates_forked_from_idx').on(t.forkedFromId),
    // Публичная лента: сорт по updatedAt / starsCount под фильтром видимости —
    // частичные индексы точно под visibleFilter (published+public+active).
    pubUpdated: index('templates_pub_updated_idx')
      .on(t.updatedAt.desc())
      .where(sql`status = 'published' and visibility = 'public' and moderation = 'active'`),
    pubStars: index('templates_pub_stars_idx')
      .on(t.starsCount.desc())
      .where(sql`status = 'published' and visibility = 'public' and moderation = 'active'`),
    ownerUpdated: index('templates_owner_updated_idx').on(t.ownerId, t.updatedAt.desc()), // списки профиля
    repository: index('templates_repository_idx').on(t.repositoryId), // списки каталога
  }),
)

// ── Template versions (лёгкое версионирование) ───────────────────────
export const templateVersions = pgTable(
  'template_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    note: text('note').notNull().default(''), // что изменилось (для «истории»)
    // Кто создал версию (для «Коммитов»: автор + аватар). Nullable: старые версии,
    // gardener и Rust-write-путь (SETFORK_DOMAIN_WRITES) автора не проставляют.
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tplVersion: uniqueIndex('template_versions_tpl_version').on(t.templateId, t.version), created: index('template_versions_created_idx').on(t.createdAt) }),
)

// ── Releases (публикация версии как релиза, как GitHub Releases) ─────
// Версии создаются автоматически (каждая правка); релиз — осознанная
// публикация конкретной версии с тегом, заголовком и notes (markdown).
export const releases = pgTable(
  'releases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(), // публикуемая версия списка
    tag: text('tag').notNull(), // человекочитаемый тег (дефолт vN)
    title: text('title').notNull().default(''),
    notes: text('notes').notNull().default(''), // markdown
    prerelease: boolean('prerelease').notNull().default(false), // пред-релиз (не «Последняя», как GitHub)
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('releases_tpl_tag').on(t.templateId, t.tag), index('releases_tpl_idx').on(t.templateId, t.createdAt)],
)

// ── Steps (= блоки списка) ───────────────────────────────────────────
// Всё-блочная модель: каждая строка — БЛОК с полем type. 'step' — исполняемый
// пункт (историческое поведение, дефолт для всех старых строк); 'text'/'image'
// — презентационные блоки (payload в content). Прогон чекает только type='step'.
export const steps = pgTable('steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  versionId: uuid('version_id')
    .notNull()
    .references(() => templateVersions.id, { onDelete: 'cascade' }),
  // СТАБИЛЬНАЯ идентичность блока СКВОЗЬ версии. steps.id — новый в каждом
  // снимке (версия = полная копия блоков), а block_id переносится из версии в
  // версию. Без него дифф сопоставляет пункты по ЗАГОЛОВКУ: переименование
  // читается как «удалён + добавлен», одинаковые заголовки коллизируют, а
  // комментарий к пункту привязывать не к чему. Модель Notion: идентичность
  // отдельно от порядка (порядок — это n).
  // Nullable: у версий, созданных до введения поля (дифф падает на фолбэк).
  // ⚠️ В git пока НЕ сериализуется (сохраняем golden-паритет с Rust), поэтому
  // проекция пуша идентичность теряет. Зеркалирование в core — отдельный этап.
  blockId: uuid('block_id'),
  n: integer('n').notNull(), // порядковый номер блока в версии (1..)
  type: text('type').notNull().default('step'), // 'step' | 'text' | 'image'
  content: jsonb('content').notNull().default({}).$type<Record<string, unknown>>(), // payload не-step блоков
  title: jsonb('title').notNull().$type<LocaleText>(),
  desc: jsonb('desc').notNull().default({}).$type<LocaleText>(),
  command: text('command').notNull().default(''),
  hasImage: boolean('has_image').notNull().default(false),
  imageKey: text('image_key'), // storage_key скриншота в S3
  level: stepLevel('level').notNull().default('required'),
  why: jsonb('why').notNull().default({}).$type<LocaleText>(), // «зачем/почему»
  section: jsonb('section').notNull().default({}).$type<LocaleText>(), // заголовок секции-группы

  // Подшаги и ссылки — простой контент шага, храним как locale-JSON.
  subtasks: jsonb('subtasks').notNull().default([]).$type<LocaleText[]>(),
  refs: jsonb('refs').notNull().default([]).$type<{ label: LocaleText; url?: string }[]>(),
}, (t) => [index('steps_block_idx').on(t.blockId)])

// ── Runs (прогон = исполняемый экземпляр шаблона на версии) ──────────
export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  templateId: uuid('template_id')
    .notNull()
    .references(() => templates.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id')
    .notNull()
    .references(() => templateVersions.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(), // денормализовано для «прогон на v3»
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  status: runStatus('status').notNull().default('active'),
  doneCount: integer('done_count').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('runs_tpl_idx').on(t.templateId), index('runs_user_idx').on(t.userId)])

// ── Состояние шага в прогоне ─────────────────────────────────────────
export const runStepState = pgTable(
  'run_step_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    stepId: uuid('step_id')
      .notNull()
      .references(() => steps.id, { onDelete: 'cascade' }),
    status: stepStatus('status').notNull().default('todo'),
    note: text('note').notNull().default(''),
    // отмеченные подшаги: массив индексов выполненных подшагов
    subtasksDone: jsonb('subtasks_done').notNull().default([]).$type<number[]>(),
    doneAt: timestamp('done_at', { withTimezone: true }),
    // «Помощь на шаге»: последний AI-ответ (markdown) — переживает перезагрузку страницы.
    assist: text('assist').notNull().default(''),
    assistAt: timestamp('assist_at', { withTimezone: true }),
  },
  (t) => ({ runStep: uniqueIndex('run_step_state_run_step').on(t.runId, t.stepId) }),
)

// ── Stars (закладка/лайк шаблона) ────────────────────────────────────
export const stars = pgTable(
  'stars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userTpl: uniqueIndex('stars_user_tpl').on(t.userId, t.templateId),
    tpl: index('stars_tpl_idx').on(t.templateId),
    userCreated: index('stars_user_created_idx').on(t.userId, t.createdAt.desc()), // вкладка «starred» профиля
  }),
)

// ── Star folders (папки для организации starred-списков, как GitHub Lists) ──
export const starFolders = pgTable(
  'star_folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('star_folders_user_name').on(t.userId, t.name), index('star_folders_user_idx').on(t.userId)],
)

// Членство: какой starred-список в какой папке (список может быть в нескольких).
export const starFolderItems = pgTable(
  'star_folder_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    folderId: uuid('folder_id')
      .notNull()
      .references(() => starFolders.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('star_folder_items_pair').on(t.folderId, t.templateId), index('star_folder_items_folder_idx').on(t.folderId)],
)

// ── Embeddings (RAG, pgvector 1536) ──────────────────────────────────
export const embeddings = pgTable(
  'embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(), // 'list'
    refId: uuid('ref_id'), // template.id
    content: text('content').notNull(),
    // halfvec(768): вдвое меньше памяти и быстрее HNSW (анализ поиска P4); 768 —
    // родная мерность Яндекс v2 и MRL-срез text-embedding-3-small. Смена типа
    // на проде = drop+add колонки (push --force), данные индекса пропадают —
    // ЗАПЛАНИРОВАННО: следом идёт полный реиндекс, до него поиск живёт на
    // лексической ветке гибрида (#377).
    embedding: halfvec('embedding', { dimensions: 768 }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('embeddings_hnsw_idx').using('hnsw', t.embedding.op('halfvec_cosine_ops')),
    index('embeddings_kind_idx').on(t.kind),
  ],
)

// ── App settings (key-value, в т.ч. AI-настройки) ────────────────────
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Фоновые задачи (durable-очередь поверх Postgres) ──────────────────
// Воркер тянет задачи `FOR UPDATE SKIP LOCKED` (безопасно между инстансами),
// при ошибке — ретрай с backoff (run_at в будущем), после max_attempts → failed.
export const jobStatus = pgEnum('job_status', ['pending', 'processing', 'done', 'failed'])
export type JobType = 'email' | 'generate' | 'reindex' | 'push' | 'digest' | 'gardener' | 'moderate' | 'triples' | 'linkcheck'

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: jobStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Индекс под выборку готовых к запуску pending-задач.
    ready: index('jobs_ready_idx').on(t.status, t.runAt),
  }),
)

// ── Web Push подписки (фоновые браузерные уведомления через service worker) ──
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byUser: index('push_subs_user_idx').on(t.userId) }),
)

// ── Digests (журнал недельного дайджеста «сохранённое дорожает») ─────
// Одна строка = одно отправленное письмо; sent_at последней строки — точка
// отсчёта следующего дайджеста пользователя (пустой дайджест не пишется).
export const digests = pgTable(
  'digests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    items: integer('items').notNull().default(0),
  },
  (t) => [index('digests_user_idx').on(t.userId, t.sentAt)],
)

// ── Suggestions (предложения правок, PR) ─────────────────────────────
export const suggestions = pgTable('suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  templateId: uuid('template_id')
    .notNull()
    .references(() => templates.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  status: suggestionStatus('status').notNull().default('open'),
  note: text('note').notNull().default(''),
  baseVersion: integer('base_version').notNull(),
  items: jsonb('items').notNull().default([]).$type<ProposedItem[]>(),
  // A3 (PR-модель): PR = «ветка → main». Задан branch_ref → items пустые,
  // предлагаемые шаги материализуются из tip ветки (gitCore.branchSnapshot).
  branchRef: text('branch_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => [index('suggestions_tpl_idx').on(t.templateId, t.status)])

// ── Ревью правки (вердикт рецензента, как review в PR) ───────────────
// Вердикты по модели GitHub/Gitea, но без их ловушек: у Gitea «request changes»
// закодирован как ReviewTypeReject, а сторона диффа — ЗНАКОМ номера строки (на
// этом у них же висит собственный FIXME). Здесь всё явными значениями.
//   comment — оставил замечания, не блокирует;
//   approve — одобрил;
//   changes — просит доработать (блокирует принятие).
// Один активный вердикт на рецензента: повторное ревью ПЕРЕЗАПИСЫВАЕТ прежний,
// иначе «одобрил → передумал» оставляло бы оба состояния сразу.
export const suggestionReviews = pgTable(
  'suggestion_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    suggestionId: uuid('suggestion_id')
      .notNull()
      .references(() => suggestions.id, { onDelete: 'cascade' }),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    verdict: text('verdict').notNull(), // 'comment' | 'approve' | 'changes'
    body: text('body').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sug_review_one_per_reviewer').on(t.suggestionId, t.reviewerId)],
)

export type SuggestionReview = typeof suggestionReviews.$inferSelect

// Комментарии-обсуждение к правке (review-комментарии, как в PR).
export const suggestionComments = pgTable(
  'suggestion_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    suggestionId: uuid('suggestion_id')
      .notNull()
      .references(() => suggestions.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('suggestion_comments_sug_idx').on(t.suggestionId)],
)

// ── Reactions (эмодзи на issues/suggestions/комментарии, как в GitHub) ──
// Полиморфно: target_type ∈ {issue, issue_comment, suggestion, suggestion_comment}.
// FK на target нет (разные таблицы); чистка — при удалении контента (сейчас не удаляем).
export const reactions = pgTable(
  'reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('reactions_uniq').on(t.userId, t.targetType, t.targetId, t.emoji),
    index('reactions_target_idx').on(t.targetType, t.targetId),
  ],
)

// ── Issues (обсуждения проблем/идей к списку) ────────────────────────
export const issues = pgTable(
  'issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(), // порядковый номер в рамках списка (#1, #2…)
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    status: issueStatus('status').notNull().default('open'),
    labels: jsonb('labels').notNull().default([]).$type<string[]>(),
    milestoneId: uuid('milestone_id').references(() => milestones.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('issues_tpl_number').on(t.templateId, t.number),
    index('issues_tpl_status_idx').on(t.templateId, t.status),
  ],
)

// Кастомные метки списка (сверх встроенной палитры): имя + hex-цвет, задаёт
// владелец. На issue хранятся ключом `c:<id>` (см. features/issues/labels).
export const listLabels = pgTable(
  'list_labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(), // hex #rrggbb
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('list_labels_tpl_name').on(t.templateId, t.name), index('list_labels_tpl_idx').on(t.templateId)],
)

// Вехи (milestones) — группировка issue по цели/срокам, как в GitHub.
export const milestones = pgTable(
  'milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    desc: text('desc').notNull().default(''),
    dueOn: timestamp('due_on', { withTimezone: true }),
    closed: boolean('closed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('milestones_tpl_idx').on(t.templateId)],
)

// Исполнители issue (много на issue, как в GitHub).
export const issueAssignees = pgTable(
  'issue_assignees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('issue_assignees_uq').on(t.issueId, t.userId), index('issue_assignees_issue_idx').on(t.issueId)],
)

export const issueComments = pgTable(
  'issue_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('issue_comments_issue_idx').on(t.issueId)],
)

// ── Discussions (форум-треды на список, как GitHub Discussions) ──────
// Категория — app-level пресет (general | ideas | q-a | show), не enum БД.
export const discussions = pgTable(
  'discussions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(), // порядковый номер в рамках списка
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull().default('general'),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('discussions_tpl_number').on(t.templateId, t.number), index('discussions_tpl_idx').on(t.templateId, t.createdAt)],
)

export const discussionComments = pgTable(
  'discussion_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    discussionId: uuid('discussion_id')
      .notNull()
      .references(() => discussions.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('discussion_comments_discussion_idx').on(t.discussionId)],
)
export type Discussion = typeof discussions.$inferSelect
export type DiscussionComment = typeof discussionComments.$inferSelect

// ── Watches (подписка на список — как Watch на GitHub) ───────────────
// Уровень подписки (дропдаун Watch на GitHub). «Participating & @mentions»
// (глобальный дефолт: только упоминания/участие) = ОТСУТСТВИЕ строки. Строка = явный
// выбор: 'all' (All Activity), 'ignore' (Never), 'custom' (по колонке events).
export const watchLevel = pgEnum('watch_level', ['all', 'ignore', 'custom'])
export const watches = pgTable(
  'watches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    // Существующие подписчики (клик Watch) → 'all' (их прежнее поведение = все обновления).
    level: watchLevel('level').notNull().default('all'),
    // Только для level='custom': какие события слать (null иначе). Доставку наблюдателям
    // имеют versions/issues/suggestions (discussions/security им пока не шлём).
    events: jsonb('events').$type<{ versions?: boolean; issues?: boolean; suggestions?: boolean }>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userTpl: uniqueIndex('watches_user_tpl').on(t.userId, t.templateId), tpl: index('watches_tpl_idx').on(t.templateId) }),
)

// ── Collaborators (совместная запись — push/правки не только владельцем) ─
// Пока привязка к списку (templateId); при вводе таблицы repositories мигрирует
// на уровень репозитория. Роль-задел: сейчас только 'write'.
export const collaboratorRole = pgEnum('collaborator_role', ['write'])
export const collaborators = pgTable(
  'collaborators',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: collaboratorRole('role').notNull().default('write'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tplUser: uniqueIndex('collab_tpl_user').on(t.templateId, t.userId) }),
)

// ── Передача владения списком (invite → accept, как перенос репозитория GitHub) ─
// Владелец создаёт pending-инвайт получателю; смена ownerId происходит ТОЛЬКО
// когда получатель принял. Один pending-инвайт на список (partial-unique ниже).
export const transferStatus = pgEnum('transfer_status', ['pending', 'accepted', 'declined', 'cancelled'])

export const transferInvites = pgTable(
  'transfer_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    fromUserId: uuid('from_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toUserId: uuid('to_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: transferStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('transfer_to_idx').on(t.toUserId, t.status),
    // Не больше ОДНОГО ожидающего инвайта на список (частичный unique).
    uniqueIndex('transfer_one_pending').on(t.templateId).where(sql`status = 'pending'`),
  ],
)

// ── Repositories (каталоги — группа из 1..N списков; git-единица в Rust-эре) ─
// Сейчас: логическая группировка. templates.repositoryId = null → solo-список.
export const repositories = pgTable(
  'repositories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(), // slug каталога (в URL)
    title: jsonb('title').notNull().default({}).$type<LocaleText>(),
    desc: jsonb('desc').notNull().default({}).$type<LocaleText>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ ownerName: uniqueIndex('repo_owner_name').on(t.ownerId, t.name) }),
)

// ── Collections (админ-курируемые кросс-авторские подборки) ───────────
// В отличие от Catalogs (репозиторий СВОИХ списков одного владельца),
// Collection собирает элементы РАЗНЫХ авторов — и списки, и каталоги.
export const collections = pgTable('collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: jsonb('title').notNull().$type<LocaleText>(),
  desc: jsonb('desc').notNull().default({}).$type<LocaleText>(),
  coverImage: text('cover_image'),
  accent: text('accent'),
  curatorId: uuid('curator_id').references(() => users.id, { onDelete: 'set null' }),
  published: boolean('published').notNull().default(false),
  position: integer('position').notNull().default(0), // порядок на витрине Explore
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Полиморфные элементы: kind 'list' → templates.id, 'catalog' → repositories.id.
// FK нет (полиморфизм) — осиротевшие ссылки отфильтровываются при чтении.
export const collectionItems = pgTable(
  'collection_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'list' | 'catalog'
    refId: uuid('ref_id').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    uniqueIndex('collection_items_uq').on(t.collectionId, t.kind, t.refId),
    index('collection_items_coll_idx').on(t.collectionId, t.position),
  ],
)
export type Collection = typeof collections.$inferSelect

// ── Poll votes (голоса за варианты poll-блока; ВНЕ git-проекции) ──────
// Poll-блок хранит варианты в steps.content (версионируется в git), а голоса —
// здесь, отдельно (как обложки: живут вне контента списка). Якорь — стабильный
// bid блока (переживает версии) + option_id. Единичный выбор чистит прошлые
// голоса юзера по этому bid перед вставкой; мульти — тоггл по варианту.
export const pollVotes = pgTable(
  'poll_votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    bid: text('bid').notNull(), // content.bid poll-блока
    optionId: text('option_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('poll_votes_uq').on(t.userId, t.templateId, t.bid, t.optionId),
    index('poll_votes_bid_idx').on(t.templateId, t.bid),
  ],
)

// ── Quiz-попытки (курсы): результат прохождения quiz-блока пользователем ──
// В отличие от poll (агрегируем голоса) — здесь ОДНА строка на (user, tpl, bid) =
// последняя попытка: что выбрал, верно ли, сколько попыток. Оценка на СЕРВЕРЕ
// (correct-флаги живут в git-content). Пересдача перезаписывает строку (attempts++).
export const quizAttempts = pgTable(
  'quiz_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    bid: text('bid').notNull(), // content.bid quiz-блока
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    selected: jsonb('selected').$type<string[]>().notNull(), // optionId, которые выбрал
    correct: boolean('correct').notNull(), // прошёл ли (точное совпадение с верными)
    attempts: integer('attempts').notNull().default(1), // число попыток (пересдачи)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('quiz_attempts_uq').on(t.userId, t.templateId, t.bid),
    index('quiz_attempts_bid_idx').on(t.templateId, t.bid),
  ],
)

// ── Прохождение курса: пользователь сдал ВСЕ тесты списка ──────────────
// Одна строка на (user, tpl) = факт завершения + версия и дата (для сертификата).
// Пишется автоматически из submitQuiz, когда пройден последний тест.
export const courseCompletions = pgTable(
  'course_completions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(), // версия списка на момент завершения
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('course_completions_uq').on(t.userId, t.templateId),
    index('course_completions_tpl_idx').on(t.templateId),
  ],
)

// ── Generations (AI-генерация: запрос + варианты-кандидаты) ──────────
// Кандидат = один сгенерированный вариант списка. «Перегенерировать» добавляет
// ещё кандидата (idx 1,2,3…); выбранный превращается в черновик-список.
export type CandidateItem = { title: string; desc: string; command: string; subtasks: string[]; section?: string; level?: StepLevel; why?: string; refs?: { label: string; url: string }[] }

export const generations = pgTable(
  'generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    query: text('query').notNull(),
    lang: text('lang').notNull().default('en'),
    chosenTemplateId: uuid('chosen_template_id').references(() => templates.id, { onDelete: 'set null' }),
    // Пишет воркер. Раньше статус ВЫВОДИЛСЯ из таблицы jobs запросом по payload->>'generationId' —
    // без индекса, на каждый поллинг каждого смотрящего (раз в 2.5с).
    // default 'done', а не 'pending': у старых строк джоб уже нет, и они не должны выглядеть висящими.
    status: generationStatus('status').notNull().default('done'),
    // Тип списка (ADR-0010): определён классификатором или выбран пользователем (переключатель в чате).
    // Свободный текст, а не pg-enum: набор типов растёт в коде (list-kind.ts), не хочется миграции enum'а.
    // Пусто у старых генераций — там переключателя не было; UI покажет по кандидату/дефолту.
    listKind: text('list_kind'),
    // Объём списка: 'short' | 'normal' | 'detailed' (shared/ai/detail-level.ts).
    // Тоже колонкой и тоже свободным текстом: воркер перечитывает её на «ещё вариант»
    // и на смене типа — иначе выбор терялся бы после первой генерации. NULL = обычный.
    detail: text('detail'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Для «истории прошлых генераций» — лента пользователя по свежести.
  (t) => [index('generations_user_idx').on(t.userId, t.createdAt)],
)

/**
 * Реплики беседы генерации: append-only, НИКОГДА не чистим — в этом весь смысл.
 * Раньше лента жила в Redis/памяти с TTL 5 минут и стиралась в начале каждой попытки, поэтому разговор
 * исчезал: пользователь терял не список (кандидаты всегда были в БД), а сам ход придумывания.
 *
 * attempt — номер витка (совпадает с generationCandidates.idx): дубли реплик лечатся группировкой по
 * витку, а не стиранием ленты, как раньше.
 */
/**
 * Сохранённые запросы к СВОИМ спискам (HQ §11, Dataview-аналог Obsidian):
 * «все книги en, которые начал» = теги + статус прогона. Живут на /my-lists
 * чипами; фильтр применяется на сервере.
 */
export const savedQueries = pgTable(
  'saved_queries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    // 'any' | 'started' (есть активный прогон) | 'done' (есть завершённый)
    runState: text('run_state').notNull().default('any'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('saved_queries_user_idx').on(t.userId)],
)

/**
 * Вики-связи список→список (HQ §11): [[handle/slug]] в текстах. Пересобирается
 * реиндексом при каждой правке (delete+insert по from_id) — как embeddings.
 * Backlinks («на этот список ссылаются») читаются по to_id.
 */
export const listLinks = pgTable(
  'list_links',
  {
    fromId: uuid('from_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    toId: uuid('to_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.fromId, t.toId] }), index('list_links_to_idx').on(t.toId)],
)

/**
 * Тройки знаний (HQ §5, старт полного KAG): «не найди похожее, а пойми связи
 * и правила» — курица→заменяется→индейка, карамель→требует→термометр.
 * Извлекаются фоном из опубликованных списков дешёвой моделью; повторное
 * извлечение той же связи из ДРУГОГО списка инкрементит confidence
 * (подтверждение практикой). Словарь relation ограничен (см. shared/ai/triples).
 */
export const knowledgeTriples = pgTable(
  'knowledge_triples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subject: text('subject').notNull(),
    relation: text('relation').notNull(),
    object: text('object').notNull(),
    domain: text('domain').notNull().default(''),
    lang: text('lang').notNull().default('en'),
    sourceTemplateId: uuid('source_template_id').references(() => templates.id, { onDelete: 'set null' }),
    confidence: integer('confidence').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('knowledge_triples_fact_idx').on(t.subject, t.relation, t.object, t.lang),
    index('knowledge_triples_domain_idx').on(t.domain),
  ],
)

/**
 * «Копать глубже» (HQ §8): слои раскопки под шагом списка. Шахта ОСТАЁТСЯ —
 * выкопанное одним видно всем следующим читателям бесплатно. Привязка к
 * (template, version, stepN): новая версия меняет шаги — честно копать заново,
 * старые штольни остаются в истории своей версии.
 * level: 1 — причины и источники, 2 — механизм и исключения, 3 — тонкости.
 */
export const digLayers = pgTable(
  'dig_layers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    stepN: integer('step_n').notNull(),
    level: integer('level').notNull(),
    lang: text('lang').notNull().default('en'),
    content: text('content').notNull(),
    // Летописец (HQ §8): модель/провайдер/на чём основан слой — пишется в момент раскопки.
    provenance: jsonb('provenance').notNull().default({}).$type<Record<string, unknown>>(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('dig_layers_step_level_idx').on(t.templateId, t.version, t.stepN, t.level, t.lang),
    index('dig_layers_tpl_idx').on(t.templateId, t.version),
  ],
)

/**
 * Благодарности гному (одушевление, идея владельца «скажут спасибо — запомнит и
 * будет добрым»): явный положительный сигнал сверх принятия списка. Питает
 * настроение (теплеет) и — позже — эпизодическую память (личные уроки). Одна
 * строка = один «спасибо» от пользователя; source различает место (dig/…).
 */
export const gnomeThanks = pgTable(
  'gnome_thanks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gnomeId: text('gnome_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull().default('dig'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('gnome_thanks_gnome_idx').on(t.gnomeId, t.createdAt)],
)

/**
 * Мини-чат раскопки (редизайн «Копать глубже»): ПЕРСОНАЛЬНАЯ беседа читателя с
 * гномом по конкретному пункту. В отличие от dig_layers (общие штольни, один
 * слой на уровень) — своя нить у каждого пользователя, живёт как сессия: открыл
 * кирку на пункте снова → видишь прошлый разговор. Привязка (template, stepN,
 * user); версию не пишем — беседа личная и продолжается через правки списка.
 */
export const digChatMessages = pgTable(
  'dig_chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    stepN: integer('step_n').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'user' | 'gnome'
    who: text('who'), // id гнома у реплик gnome; null у пользователя
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('dig_chat_thread_idx').on(t.templateId, t.stepN, t.userId, t.createdAt)],
)

export const generationMessages = pgTable(
  'generation_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    generationId: uuid('generation_id')
      .notNull()
      .references(() => generations.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull().default(1),
    // Текст, а не pg-enum: роли совета меняются на ходу (добавили эксперта — не ловить миграцию enum'а).
    // В TS сужается до GenMessageKind.
    kind: text('kind').notNull(),
    who: text('who'), // id аватарки: public/gnomes/<who>.webp
    name: text('name'), // подпись говорящего (локализуем на сервере: ростер под server-only)
    text: text('text').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('generation_messages_gen_idx').on(t.generationId, t.createdAt)],
)

export const generationCandidates = pgTable(
  'generation_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    generationId: uuid('generation_id')
      .notNull()
      .references(() => generations.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(), // порядковый номер варианта (1..)
    title: text('title').notNull(),
    desc: text('desc').notNull().default(''),
    // «Что поменялось ключевое» относительно предыдущего варианта — одной фразой, пишет модель.
    // У первого варианта пусто: сравнивать не с чем.
    summary: text('summary').notNull().default(''),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    items: jsonb('items').notNull().default([]).$type<CandidateItem[]>(),
    // Провенанс витка (объяснимость, HQ §6): кто из гномов участвовал и на какой
    // модели, какие прецеденты пошли в промпты, что сказал критик. Пишется В МОМЕНТ
    // совета — задним числом эту историю не восстановить. Пустой объект у одиночных
    // генераций и старых кандидатов.
    provenance: jsonb('provenance').notNull().default({}).$type<Record<string, unknown>>(),
    // Подсказка «что улучшить следующим» по ТЕМЕ (GeneratedList.hint) — плейсхолдер-призрак
    // поля ввода в чате. Пусто у старых кандидатов → статичный refineHint по типу.
    hint: text('hint').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('generation_candidates_gen_idx').on(t.generationId, t.idx),
    index('generation_candidates_gen_idx2').on(t.generationId),
  ],
)

/**
 * Ростер совета: персонажи-эксперты. Раньше был константой EXPERTS в council.ts — правился только
 * кодом и деплоем.
 *
 * persona — инструкция модели (манера, на что смотрит).
 * domains — по ним распорядитель созывает; '*' = универсал, годится на любую тему.
 * model — принудительная модель для этого эксперта; пусто → берётся из пула совета по кругу.
 * avatar — id встроенной картинки (public/gnomes/<id>.webp) ИЛИ ключ в S3 у загруженной.
 * enabled/sort — выключение без удаления и порядок. Удалять нельзя без нужды: id зашит в аватарку
 * и в поле who прошлых бесед (generation_messages) — удалишь, и история осиротеет.
 */
export const councilExperts = pgTable(
  'council_experts',
  {
    // Не uuid: id смысловой ('chef'), он же имя встроенной аватарки и значение who в беседе.
    id: text('id').primaryKey(),
    nameEn: text('name_en').notNull(),
    nameRu: text('name_ru').notNull(),
    persona: text('persona').notNull(),
    // Гильдия (HQ §7): гном — носитель гильдии, совет один — голоса разные.
    guildEn: text('guild_en').notNull().default(''),
    guildRu: text('guild_ru').notNull().default(''),
    // Кодекс гильдии — свод стандартов качества: подмешивается в промпт гнома,
    // критик получает объединение кодексов как мерило (черновики анонимны — без авторства).
    code: text('code').notNull().default(''),
    // Линза запроса (HQ §5, шаг 2): КАК гном спрашивает общую базу — короткая добавка
    // аспектов к запросу перед embed (повар — ингредиенты/техника, девопсер — откаты).
    // Применяется там, где работает ОДИН гном (ask_gnome, dig); в совете — доменный фильтр.
    lens: text('lens').notNull().default(''),
    // Память гнома (HQ §3, этап 2): фоновая выжимка ремесла из ЛУЧШИХ списков его
    // доменов — «гном учится на публикациях». Обновляет рудник знаний; видна на
    // личной странице; подмешивается в его промпты (spotlight — материал чужой).
    memory: text('memory').notNull().default(''),
    memoryUpdatedAt: timestamp('memory_updated_at', { withTimezone: true }),
    domains: text('domains').array().notNull().default(sql`'{}'::text[]`),
    model: text('model').notNull().default(''),
    avatar: text('avatar').notNull().default(''),
    // Загруженная картинка лежит в S3 — отличаем от встроенной, чтобы знать, чем её отдавать.
    avatarUploaded: boolean('avatar_uploaded').notNull().default(false),
    online: boolean('online').notNull().default(false), // давать ли веб-поиск (:online)
    enabled: boolean('enabled').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('council_experts_sort_idx').on(t.enabled, t.sort)],
)

// ── AI usage (учёт токенов/денег по каждому вызову ИИ) ───────────────
// Одна строка = один вызов модели. costUsd — фактическая стоимость OpenRouter
// (usage accounting), с фолбэком на расчёт по ценам моделей.
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }), // null — системный вызов
    feature: aiFeature('feature').notNull(),
    model: text('model').notNull().default(''),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    refType: text('ref_type'), // 'generation' | 'template' | …
    refId: uuid('ref_id'),
    // Исход вызова — сырьё для щитка надёжности и авторотации пула совета:
    // ok | timeout | invalid (модель ответила мусором/не-JSON) | error (сеть/провайдер).
    outcome: text('outcome').notNull().default('ok'),
    durationMs: integer('duration_ms').notNull().default(0), // латентность вызова (p95 в щитке)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_usage_user_idx').on(t.userId, t.createdAt),
    index('ai_usage_created_idx').on(t.createdAt),
    // Щиток/карантин агрегируют по модели за окно времени.
    index('ai_usage_model_idx').on(t.model, t.createdAt),
  ],
)

// ── Traffic: просмотры списков ───────────────────────────────────────
// Уникальный ДНЕВНОЙ просмотр: visitor = 'u:<userId>' для вошедших или
// 'a:<sha256(ip|ua|день|секрет)>' для анонимов — анонимный хеш ротируется
// ежедневно, PII не храним, кросс-дневного трекинга нет. Просмотры владельца
// не пишутся. Это фундамент аналитики трафика (Ф-M0 монетизации).
export const templateViews = pgTable(
  'template_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }), // null — аноним
    visitor: text('visitor').notNull(),
    day: date('day').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('template_views_uq').on(t.templateId, t.visitor, t.day),
    index('template_views_tpl_idx').on(t.templateId, t.createdAt),
  ],
)

// ── Traffic: клики по внешним ссылкам (refs шагов) ───────────────────
// Журнал переходов через /api/go/[step]/[ref] — url снапшотится на момент
// клика (контент версионируется, ссылка может исчезнуть). Клики владельца и
// ботов не пишутся. Задел под партнёрскую аналитику: host — для сводок по
// магазинам/доменам.
export const linkClicks = pgTable(
  'link_clicks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    stepId: uuid('step_id').references(() => steps.id, { onDelete: 'set null' }),
    refIndex: integer('ref_index').notNull().default(0),
    url: text('url').notNull(),
    host: text('host').notNull().default(''),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }), // null — аноним
    visitor: text('visitor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('link_clicks_tpl_idx').on(t.templateId, t.createdAt),
    index('link_clicks_host_idx').on(t.templateId, t.host),
  ],
)

// ── Link-checker («живые списки», Ж1): здоровье внешних URL ──────────
// Вердикт — свойство САМОГО URL (мёртв для всех), поэтому храним per-URL
// глобально (дедуп проб повторяющихся ссылок), а привязку к спискам — через
// таблицу вхождений. broken присваивается ТОЛЬКО эскалацией fail_count через
// несколько свипов; сетевые отказы (ТСПУ/SNI) в broken не эскалируют никогда.
export const linkVerdict = pgEnum('link_verdict', ['ok', 'redirected', 'broken', 'unreachable', 'uncheckable'])

export const linkChecks = pgTable(
  'link_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    urlNorm: text('url_norm').notNull().unique(), // normalizeUrl(): без #fragment, lower scheme/host, cap 2048
    host: text('host').notNull(),
    httpStatus: integer('http_status'), // null = не дошли до HTTP (dns/сеть/SSRF-отказ)
    finalUrl: text('final_url'), // после редиректов — сырьё для предложения замены
    verdict: linkVerdict('verdict'), // null = ещё не проверялся
    reason: text('reason'), // 'http_404'|'dns'|'timeout'|'net'|'soft404'|'bot_block'|…
    failCount: integer('fail_count').notNull().default(0), // подряд broken-кандидатных свипов; успех → 0
    lastOkAt: timestamp('last_ok_at', { withTimezone: true }),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('link_checks_due_idx').on(t.nextCheckAt),
    index('link_checks_host_idx').on(t.host),
    index('link_checks_verdict_idx').on(t.verdict),
  ],
)

// Вхождение URL в контент списка. Пересобирается delete+insert per template
// при харвесте (полная материализация — как suggestions.items).
export const linkOccurrences = pgTable(
  'link_occurrences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    stepId: uuid('step_id').references(() => steps.id, { onDelete: 'cascade' }), // null = desc списка
    urlNorm: text('url_norm').notNull(),
    source: text('source', { enum: ['ref', 'product', 'video', 'file', 'inline'] }).notNull(),
    refIndex: integer('ref_index').notNull().default(0),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('link_occ_tpl_idx').on(t.templateId), index('link_occ_url_idx').on(t.urlNorm)],
)

// ── Feedback (обратная связь с сайта) ────────────────────────────────
// Канал «главный пробел» (владелец, 2026-07-07): форма /feedback, разбор в
// /admin/feedback. email — опциональный контакт для ответа (PII: только для
// ответа, покрыт Privacy Policy «Support data»). pageUrl — откуда пришли.
export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }), // null — аноним
    category: feedbackCategory('category').notNull().default('other'),
    body: text('body').notNull(),
    email: text('email').notNull().default(''),
    pageUrl: text('page_url').notNull().default(''),
    status: feedbackStatus('status').notNull().default('new'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('feedback_status_idx').on(t.status, t.createdAt)],
)

// ── Content reports (жалобы на списки) ───────────────────────────────
// DSA notice-and-action + приём копирайт/приватность-жалоб («Report list» на
// странице списка). Жалоба НЕ меняет видимость списка сама по себе — только
// запись + аудит + фоновая ИИ-перепроверка; решение принимает админ.
// Счётчики по статусам — задел под DSA transparency-отчётность.
export const contentReports = pgTable(
  'content_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    reporterUserId: uuid('reporter_user_id').references(() => users.id, { onDelete: 'set null' }), // null — аноним
    reason: reportReason('reason').notNull().default('other'),
    body: text('body').notNull(),
    email: text('email').notNull().default(''), // контакт для ответа (важно для DMCA)
    status: reportStatus('status').notNull().default('new'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('content_reports_status_idx').on(t.status, t.createdAt),
    index('content_reports_tpl_idx').on(t.templateId, t.createdAt),
  ],
)

// ── Follows (подписки пользователей) ─────────────────────────────────
export const follows = pgTable(
  'follows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    followerId: uuid('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followingId: uuid('following_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('follows_pair').on(t.followerId, t.followingId), index('follows_following_idx').on(t.followingId)],
)

// ── 2FA recovery-коды: показываются один раз, храним только sha256 ────
export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('recovery_codes_user_idx').on(t.userId)],
)

// ── Passkeys (WebAuthn — беспарольный вход) ──────────────────────────
// Публичный ключ (COSE) и credentialId храним base64url; counter — anti-replay.
export const passkeys = pgTable(
  'passkeys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull().unique(), // base64url
    publicKey: text('public_key').notNull(), // base64url COSE-ключа
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: text('transports'), // usb,nfc,ble,internal — через запятую
    deviceType: text('device_type'), // singleDevice | multiDevice
    backedUp: boolean('backed_up').notNull().default(false),
    name: text('name').notNull().default('Passkey'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [index('passkeys_user_idx').on(t.userId)],
)
export type Passkey = typeof passkeys.$inferSelect

// ── API tokens (доступ по MCP / API — Bearer) ────────────────────────
// Храним только sha256-хеш токена; полный токен показываем один раз при создании.
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    prefix: text('prefix').notNull(), // для отображения, напр. sf_ab12cd…
    scope: text('scope').notNull().default('write'), // 'read' (clone/pull) | 'write' (+push)
    expiresAt: timestamp('expires_at', { withTimezone: true }), // null = бессрочный
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('api_tokens_user_idx').on(t.userId)],
)

// ── Audit log (кто что сделал: пуши, удаления, токены, модерация) ────
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(), // напр. 'token.create' | 'list.delete' | 'git.push'
    targetType: text('target_type'), // 'list' | 'token' | 'session' | …
    targetId: text('target_id'), // uuid или ref/slug (text для гибкости)
    meta: jsonb('meta').notNull().default({}).$type<Record<string, unknown>>(),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_created_idx').on(t.createdAt), index('audit_log_actor_idx').on(t.actorId)],
)

// ── Sessions (серверный реестр входов — для отзыва и «кто онлайн») ────
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    ip: text('ip'),
    geo: text('geo'), // «City, CC» по IP (best-effort, как «Seen in …» у GitHub)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_last_seen_idx').on(t.lastSeenAt)],
)

// ── Notifications (колокольчик) ──────────────────────────────────────
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    type: notificationType('type').notNull(),
    templateId: uuid('template_id').references(() => templates.id, { onDelete: 'cascade' }),
    issueId: uuid('issue_id').references(() => issues.id, { onDelete: 'cascade' }),
    suggestionId: uuid('suggestion_id').references(() => suggestions.id, { onDelete: 'cascade' }),
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_recipient_idx').on(t.recipientId, t.read),
    index('notifications_recipient_created_idx').on(t.recipientId, t.createdAt.desc()), // колокол: последние N
  ],
)

// ── Relations ────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  templates: many(templates),
  runs: many(runs),
}))

export const repositoriesRelations = relations(repositories, ({ one, many }) => ({
  owner: one(users, { fields: [repositories.ownerId], references: [users.id] }),
  lists: many(templates),
}))

export const templatesRelations = relations(templates, ({ one, many }) => ({
  owner: one(users, { fields: [templates.ownerId], references: [users.id] }),
  repository: one(repositories, { fields: [templates.repositoryId], references: [repositories.id] }),
  topic: one(topics, { fields: [templates.topicId], references: [topics.id] }),
  forkedFrom: one(templates, {
    fields: [templates.forkedFromId],
    references: [templates.id],
    relationName: 'fork',
  }),
  versions: many(templateVersions),
  runs: many(runs),
}))

export const templateVersionsRelations = relations(templateVersions, ({ one, many }) => ({
  template: one(templates, { fields: [templateVersions.templateId], references: [templates.id] }),
  steps: many(steps),
}))

export const stepsRelations = relations(steps, ({ one }) => ({
  version: one(templateVersions, { fields: [steps.versionId], references: [templateVersions.id] }),
}))

export const issuesRelations = relations(issues, ({ one, many }) => ({
  template: one(templates, { fields: [issues.templateId], references: [templates.id] }),
  author: one(users, { fields: [issues.authorId], references: [users.id] }),
  comments: many(issueComments),
}))

export const issueCommentsRelations = relations(issueComments, ({ one }) => ({
  issue: one(issues, { fields: [issueComments.issueId], references: [issues.id] }),
  author: one(users, { fields: [issueComments.authorId], references: [users.id] }),
}))

export const suggestionCommentsRelations = relations(suggestionComments, ({ one }) => ({
  suggestion: one(suggestions, { fields: [suggestionComments.suggestionId], references: [suggestions.id] }),
  author: one(users, { fields: [suggestionComments.authorId], references: [users.id] }),
}))

export const runsRelations = relations(runs, ({ one, many }) => ({
  template: one(templates, { fields: [runs.templateId], references: [templates.id] }),
  version: one(templateVersions, { fields: [runs.versionId], references: [templateVersions.id] }),
  user: one(users, { fields: [runs.userId], references: [users.id] }),
  stepStates: many(runStepState),
}))

export const runStepStateRelations = relations(runStepState, ({ one }) => ({
  run: one(runs, { fields: [runStepState.runId], references: [runs.id] }),
  step: one(steps, { fields: [runStepState.stepId], references: [steps.id] }),
}))

export const suggestionsRelations = relations(suggestions, ({ one, many }) => ({
  template: one(templates, { fields: [suggestions.templateId], references: [templates.id] }),
  author: one(users, { fields: [suggestions.authorId], references: [users.id] }),
  comments: many(suggestionComments),
}))

export const generationsRelations = relations(generations, ({ one, many }) => ({
  user: one(users, { fields: [generations.userId], references: [users.id] }),
  candidates: many(generationCandidates),
}))

export const generationCandidatesRelations = relations(generationCandidates, ({ one }) => ({
  generation: one(generations, { fields: [generationCandidates.generationId], references: [generations.id] }),
}))

// ── Inferred types ───────────────────────────────────────────────────
export type User = typeof users.$inferSelect
export type Topic = typeof topics.$inferSelect
export type Template = typeof templates.$inferSelect
export type TemplateVersion = typeof templateVersions.$inferSelect
export type Step = typeof steps.$inferSelect
export type Run = typeof runs.$inferSelect
export type RunStepState = typeof runStepState.$inferSelect
// ── Комментарии к пункту (и к выделенной части его текста) ───────────
// Тред — единица обсуждения, разрешения И устаревания (как PullRequestReviewThread
// у GitHub: isResolved/isOutdated живут на треде, а не на отдельной реплике).
//
// Якорь file-relative, а не diff-relative: блок опознаётся стабильным block_id,
// место внутри блока — W3C-селекторами. Индекс строки внутри диффа (position
// у GitHub) сознательно НЕ реализуем: он хрупок, и GitHub сам пометил его
// deprecated в своей OpenAPI-спеке.
//
// Три позиции — контракт GitLab (lib/gitlab/diff/position_tracer, MIT):
//   anchor_original — иммутабельна, «где это было сказано»;
//   anchor_current  — сдвигается вперёд, пока якорь находится;
//   anchor_changed_at — версия, на которой якорь потеряли (пусто = не терялся).
// Плюс вмороженный снимок текста (роль diff_hunk у GitHub / note_diff_files у
// GitLab): тред всегда может показать свой контекст, ничего не переспрашивая.
export const blockCommentThreads = pgTable(
  'block_comment_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    /** Стабильная идентичность блока (steps.block_id) — переживает версии. */
    blockId: uuid('block_id').notNull(),
    /** Поле блока: 'title' | 'desc' | 'why' | 'command' | 'content.md' и т.п. */
    field: text('field').notNull().default('desc'),
    /** Версия, на которой тред заведён. */
    createdVersion: integer('created_version').notNull(),
    anchorOriginal: jsonb('anchor_original').notNull().$type<Record<string, unknown>>(),
    anchorCurrent: jsonb('anchor_current').$type<Record<string, unknown> | null>(),
    /** 'anchored' | 'reanchored' | 'orphaned' — три состояния, а не два. */
    anchorState: text('anchor_state').notNull().default('anchored'),
    /** Уверенность последней пере-привязки, 0..100 (пусто — не перепривязывался). */
    anchorConfidence: integer('anchor_confidence'),
    /** Версия, на которой якорь потеряли (аналог change_position у GitLab). */
    anchorChangedAt: integer('anchor_changed_at'),
    /** Вмороженный текст поля на момент создания — контекст треда навсегда. */
    contextSnapshot: text('context_snapshot').notNull().default(''),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedById: uuid('resolved_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('bct_tpl_idx').on(t.templateId), index('bct_block_idx').on(t.blockId)],
)

export const blockComments = pgTable(
  'block_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => blockCommentThreads.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('bc_thread_idx').on(t.threadId)],
)

export type BlockCommentThread = typeof blockCommentThreads.$inferSelect
export type BlockComment = typeof blockComments.$inferSelect

export type Suggestion = typeof suggestions.$inferSelect
export type Generation = typeof generations.$inferSelect
export type GenerationCandidate = typeof generationCandidates.$inferSelect
export type AiUsage = typeof aiUsage.$inferSelect
export type ApiToken = typeof apiTokens.$inferSelect
