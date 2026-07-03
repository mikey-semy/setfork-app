// Схема БД SetFork (MVP чек-листов).
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
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'
import type { LocaleText } from '../i18n'

// ── Enums ────────────────────────────────────────────────────────────
export const templateOrigin = pgEnum('template_origin', ['authored', 'forked', 'ai_draft'])
export const listVisibility = pgEnum('list_visibility', ['public', 'private'])
// draft — черновик (не опубликован, виден только владельцу); published — опубликован (виден по visibility).
export const listStatus = pgEnum('list_status', ['draft', 'published'])
// active — норма; flagged — на проверку (репорт/ИИ); hidden — скрыт админом (не публичен).
export const moderationStatus = pgEnum('moderation_status', ['active', 'flagged', 'hidden'])
export const runStatus = pgEnum('run_status', ['active', 'done', 'abandoned'])
export const stepStatus = pgEnum('step_status', ['todo', 'cur', 'done'])
// Уровень важности шага (как в стандартах: MUST / SHOULD / MAY).
export const stepLevel = pgEnum('step_level', ['required', 'recommended', 'optional'])
export const suggestionStatus = pgEnum('suggestion_status', ['open', 'accepted', 'rejected'])
// Тип AI-вызова для учёта расхода (токены/деньги).
export const aiFeature = pgEnum('ai_feature', ['generate', 'regenerate', 'refine', 'note', 'moderate', 'embed'])
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
])

export const issueStatus = pgEnum('issue_status', ['open', 'closed'])

// Предложенный пункт (снимок правки внутри suggestion).
export type StepLevel = 'required' | 'recommended' | 'optional'
export type ProposedItem = {
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
}

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  githubId: bigint('github_id', { mode: 'number' }).unique(), // null для demo-пользователя и ghost
  email: text('email').unique(), // вход по паролю (null у github/demo/ghost)
  passwordHash: text('password_hash'), // scrypt-хеш (null у oauth)
  handle: text('handle').notNull().unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  bio: text('bio'),
  location: text('location'),
  website: text('website'),
  socials: jsonb('socials').notNull().default([]).$type<Social[]>(),
  notifyPrefs: jsonb('notify_prefs').notNull().default({}).$type<NotifyPrefs>(),
  deleted: boolean('deleted').notNull().default(false), // true у ghost / удалённых аккаунтов
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Topics (темы/домены с цветом — сайдбар Explore) ──────────────────
export const topics = pgTable('topics', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  label: jsonb('label').notNull().$type<LocaleText>(),
  color: text('color').notNull(), // hex, напр. #2563eb
})

// ── Templates (список/чек-лист) ──────────────────────────────────────
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
    // true — упорядоченный (шаги 1..N); false — набор/чек-лист (порядок неважен).
    ordered: boolean('ordered').notNull().default(true),
    visibility: listVisibility('visibility').notNull().default('public'),
    moderation: moderationStatus('moderation').notNull().default('active'),
    moderationReason: text('moderation_reason'),
    verified: boolean('verified').notNull().default(false),
    pinned: boolean('pinned').notNull().default(false), // закреплён владельцем на профиле
    repositoryId: uuid('repository_id'), // каталог-репозиторий (FK задаётся в relations); null = solo
    forkedFromId: uuid('forked_from_id'), // самоссылка задаётся в relations
    runsCount: integer('runs_count').notNull().default(0),
    forksCount: integer('forks_count').notNull().default(0),
    starsCount: integer('stars_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ ownerSlug: unique('templates_owner_slug').on(t.ownerId, t.slug) }),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tplVersion: unique('template_versions_tpl_version').on(t.templateId, t.version) }),
)

// ── Steps ────────────────────────────────────────────────────────────
export const steps = pgTable('steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  versionId: uuid('version_id')
    .notNull()
    .references(() => templateVersions.id, { onDelete: 'cascade' }),
  n: integer('n').notNull(), // порядковый номер (1..)
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
})

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
})

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
  },
  (t) => ({ runStep: unique('run_step_state_run_step').on(t.runId, t.stepId) }),
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
  (t) => ({ userTpl: unique('stars_user_tpl').on(t.userId, t.templateId) }),
)

// ── Embeddings (RAG, pgvector 1536) ──────────────────────────────────
export const embeddings = pgTable(
  'embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(), // 'list'
    refId: uuid('ref_id'), // template.id
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('embeddings_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('embeddings_kind_idx').on(t.kind),
  ],
)

// ── App settings (key-value, в т.ч. AI-настройки) ────────────────────
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
})

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
    unique('reactions_uniq').on(t.userId, t.targetType, t.targetId, t.emoji),
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
    unique('issues_tpl_number').on(t.templateId, t.number),
    index('issues_tpl_status_idx').on(t.templateId, t.status),
  ],
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
  (t) => [unique('issue_assignees_uq').on(t.issueId, t.userId), index('issue_assignees_issue_idx').on(t.issueId)],
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

// ── Watches (подписка на список — как Watch на GitHub) ───────────────
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userTpl: unique('watches_user_tpl').on(t.userId, t.templateId) }),
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
  (t) => ({ tplUser: unique('collab_tpl_user').on(t.templateId, t.userId) }),
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
  (t) => ({ ownerName: unique('repo_owner_name').on(t.ownerId, t.name) }),
)

// ── Generations (AI-генерация: запрос + варианты-кандидаты) ──────────
// Кандидат = один сгенерированный вариант списка. «Перегенерировать» добавляет
// ещё кандидата (idx 1,2,3…); выбранный превращается в черновик-список.
export type CandidateItem = { title: string; desc: string; command: string; subtasks: string[]; level?: StepLevel; why?: string }

export const generations = pgTable('generations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  query: text('query').notNull(),
  lang: text('lang').notNull().default('en'),
  chosenTemplateId: uuid('chosen_template_id').references(() => templates.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

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
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    items: jsonb('items').notNull().default([]).$type<CandidateItem[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('generation_candidates_gen_idx').on(t.generationId, t.idx),
    index('generation_candidates_gen_idx2').on(t.generationId),
  ],
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_usage_user_idx').on(t.userId, t.createdAt), index('ai_usage_created_idx').on(t.createdAt)],
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
  (t) => [unique('follows_pair').on(t.followerId, t.followingId), index('follows_following_idx').on(t.followingId)],
)

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
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('api_tokens_user_idx').on(t.userId)],
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
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_recipient_idx').on(t.recipientId, t.read)],
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
export type Suggestion = typeof suggestions.$inferSelect
export type Generation = typeof generations.$inferSelect
export type GenerationCandidate = typeof generationCandidates.$inferSelect
export type AiUsage = typeof aiUsage.$inferSelect
export type ApiToken = typeof apiTokens.$inferSelect
