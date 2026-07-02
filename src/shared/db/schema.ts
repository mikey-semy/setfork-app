// Схема БД SetHub (MVP чек-листов).
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
export const runStatus = pgEnum('run_status', ['active', 'done', 'abandoned'])
export const stepStatus = pgEnum('step_status', ['todo', 'cur', 'done'])
export const suggestionStatus = pgEnum('suggestion_status', ['open', 'accepted', 'rejected'])
export const notificationType = pgEnum('notification_type', [
  'suggestion_new',
  'suggestion_accepted',
  'suggestion_rejected',
  'star',
  'fork',
])

// Предложенный пункт (снимок правки внутри suggestion).
export type ProposedItem = {
  title: LocaleText
  desc: LocaleText
  command: string
  hasImage: boolean
  imageKey?: string // storage_key скриншота в S3 (если есть)
  subtasks: LocaleText[]
  refs: { label: LocaleText; url?: string }[]
}

// ── Users ────────────────────────────────────────────────────────────
// handle = публичный идентификатор в модели owner/name (как в дизайне: acme/deploy-to-vps).
export type Social = { type: string; url: string } // type: github | x | telegram | youtube | linkedin | site …

// Предпочтения уведомлений. Отсутствие ключа = включено (opt-out).
export type NotifyPrefs = { newSuggestions?: boolean; suggestionResolved?: boolean; stars?: boolean; forks?: boolean }

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

export const templatesRelations = relations(templates, ({ one, many }) => ({
  owner: one(users, { fields: [templates.ownerId], references: [users.id] }),
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

export const suggestionsRelations = relations(suggestions, ({ one }) => ({
  template: one(templates, { fields: [suggestions.templateId], references: [templates.id] }),
  author: one(users, { fields: [suggestions.authorId], references: [users.id] }),
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
