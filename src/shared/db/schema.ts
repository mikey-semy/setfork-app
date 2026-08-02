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
  real,
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
// 'gate' — линзы готовности к публикации (отдельно от 'moderate': та решает «безопасно ли
// показывать», эта — «готово ли к показу»; смешивать их в учёте расхода нельзя).
export const aiFeature = pgEnum('ai_feature', ['generate', 'regenerate', 'refine', 'note', 'moderate', 'embed', 'translate', 'mcp-gnome', 'dig', 'assist', 'gate', 'landing'])
export const notificationType = pgEnum('notification_type', [
  'suggestion_new',
  'suggestion_accepted',
  'suggestion_edited',
  'suggestion_rejected',
  'suggestion_comment',
  'issue_new',
  'issue_comment',
  'issue_closed_by_merge', // твою задачу закрыли принятым предложением
  'new_version',
  'star',
  'fork',
  'follow',
  'mention',
  'assigned',
  'review_requested', // тебя попросили посмотреть правку
  'review_dismissed', // твой вердикт снял мейнтейнер
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
  /** «Здесь нужен человек»: машина не может знать этого — местные цены, вкус, опыт. */
  needsHuman?: boolean
  /** Что спросить у человека (пусто при needsHuman → общий текст). */
  needsHumanAsk?: LocaleText
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
  uiScale: text('ui_scale'), // Appearance: масштаб интерфейса ('90' / '' / '110'; '' / null = 100%) — работает поверх rem-размеров (Ф6)
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
  // ЧЕСТНАЯ ПОМЕТКА (ADR-0004): 'agent' — не человек, а служебный участник (садовник,
  // специалисты совета). Раньше служебность угадывалась по handle='gardener' и эмодзи в
  // bio, то есть данными нигде не была. Специалист участвует наравне с людьми (свои
  // списки, обсуждения, правки), поэтому его нечеловечность обязана быть видна.
  accountType: text('account_type').notNull().default('human').$type<'human' | 'agent'>(),
  // Профессия — «должность» в профиле (у специалиста буквальная: повар, девопс; у
  // человека необязательна). Имя остаётся именем, профессия живёт здесь, а не в имени.
  profession: text('profession'),
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
/**
 * Настройки предложений на списке — аналог раздела Pull Requests у GitHub.
 *
 * Все поля опциональны: отсутствие = дефолт, описанный в `PR_DEFAULTS`. Так
 * добавление нового флага не требует миграции существующих строк.
 */
export interface PrSettings {
  /** Кто может создавать предложения: все или только коллаборанты. */
  allowFrom?: 'all' | 'collaborators'
  /** Требовать линейную историю: сливать только fast-forward, иначе просить обновить ветку. */
  linearOnly?: boolean
  /** Способ слияния: обычный (ff/merge-коммит) или squash — один коммит с трейлерами соавторов. */
  mergeMethod?: 'merge' | 'squash'
  /** Нерешённые обсуждения блокируют слияние. */
  blockOnUnresolved?: boolean
  /** Внешние проверки должны пройти: упавшая или незавершённая держит слияние. */
  blockOnFailedChecks?: boolean
  /** Сколько одобрений нужно (0 = не требуются). */
  requiredApprovals?: number
  /** Удалять ветку сразу после слияния. */
  autoDeleteBranch?: boolean
  /** Закрывать задачи по «closes #N» при слиянии. */
  autoCloseIssues?: boolean
  /**
   * Разрешить владельцу и коллаборантам править ЧУЖОЕ предложение.
   *
   * Аналог «Allow edits by maintainers» у GitHub, но решение принимает владелец
   * списка, а не автор правки: у нас список — единица владения, и держать флаг
   * на каждом предложении значило бы спрашивать одно и то же каждый раз.
   * Автор своё предложение правит всегда, независимо от настройки.
   */
  allowMaintainerEdits?: boolean
}

/** Дефолты настроек предложений = поведение до их появления. */
export const PR_DEFAULTS: Required<PrSettings> = {
  allowFrom: 'all',
  linearOnly: false,
  // Обычное слияние по умолчанию: squash теряет промежуточную историю, и выбирать
  // такую потерю должен человек, а не установка по умолчанию.
  mergeMethod: 'merge',
  blockOnUnresolved: true,
  // Выключено по умолчанию: проверку присылает кто-то снаружи, и включённый по
  // умолчанию гейт означал бы, что первый же чужой отчёт запирает список.
  blockOnFailedChecks: false,
  requiredApprovals: 0,
  autoDeleteBranch: false,
  autoCloseIssues: true,
  // Выключено по умолчанию: правка чужого текста — это то, на что соглашаются
  // осознанно, а не обнаруживают постфактум.
  allowMaintainerEdits: false,
}

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
    // Настройки предложений (≈ раздел Pull Requests в настройках репо GitHub).
    // Одним jsonb, а не колонкой на галочку: набор будет расти, а формы под
    // «одно поле = одна колонка» на каждый флаг мы уже проходили.
    // Дефолты = поведение до появления настроек, чтобы старые списки не менялись.
    prSettings: jsonb('pr_settings').notNull().default({}).$type<PrSettings>(),
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
    /** Ф3: push-зеркало в GitHub/GitLab. SetFork — источник истины, форджа —
     *  витрина/бэкап. Токен шифрован (AES-GCM, общий SETFORK_MIRROR_SECRET с
     *  ядром — пушит оно). Статус последнего пуша: ошибка видна владельцу,
     *  молчаливой деградации нет. */
    mirrorUrl: text('mirror_url'),
    mirrorToken: text('mirror_token'),
    mirrorSyncedAt: timestamp('mirror_synced_at', { withTimezone: true }),
    mirrorError: text('mirror_error'),
    /**
     * ЖИВОЙ СПИСОК (лента): не «готов навсегда», а с ритмом обновления.
     *
     * Отдельным признаком, а НЕ значением list_kind: тип — это ФОРМА (пошагово / чеклист /
     * рецепт), от неё зависят политики ухода и форма JSON. «Живой» — режим жизни, и живым
     * может быть и чеклист, и набор вариантов. Смешать два ортогональных понятия в одной
     * колонке — то, за что потом платят разбором.
     *
     * Что меняется: планка судит такой список СВЕЖЕСТЬЮ вместо класса полноты
     * (shared/ai/readiness), правило остановки не применяется («улучшать нечего» для ленты
     * значит «нет новостей», а не «пора расходиться форком»), а уход ДОБАВЛЯЕТ новое из
     * потока вместо полировки старого.
     *
     * Продуктовый флаг уровня списка — как list_kind / gated / pr_settings: доменного
     * контракта (CreateListInput, proto) он не касается и пишется прямым апдейтом.
     */
    living: boolean('living').notNull().default(false),
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

  // «ЗДЕСЬ НУЖЕН ЧЕЛОВЕК» — честная пометка там, где машина знать не может: местные
  // цены и наличие, вкус и ощущение, время на ВАШЕМ оборудовании, региональные правила.
  // Это не дефект списка, а приглашение: реальность и опыт доступны человеку, не модели.
  // Выдумка вреднее скудности — пусть лучше стоит пометка, чем правдоподобная цифра.
  needsHuman: boolean('needs_human').notNull().default(false),
  /** Что именно спросить у человека («сколько стоит в вашем городе»). Пусто — общий текст. */
  needsHumanAsk: jsonb('needs_human_ask').notNull().default({}).$type<LocaleText>(),
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

/**
 * ПУБЛИЧНЫЙ CHANGELOG продукта.
 *
 * Раньше это был массив в коде, который надо было править руками — и он, конечно,
 * отстал на три недели: ручной changelog не ведут, его забывают. Теперь записи
 * лежат в БД и пополняются джобой из GitHub (релизы или слитые предложения), а
 * руками добавленное живёт рядом и не затирается.
 *
 * `externalId` — ключ идемпотентности («pr:519», «rel:v1.2»): повторный проход
 * джобы обновляет ту же запись, а не плодит копии. У ручных записей его нет.
 */
export const changelogEntries = pgTable(
  'changelog_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** День, за который запись показывают (не время джобы). */
    at: timestamp('at', { withTimezone: true }).notNull(),
    /** Оба языка: интерфейс двуязычный, и changelog не исключение. */
    en: text('en').notNull(),
    ru: text('ru').notNull(),
    /** Куда ведёт запись: PR/релиз на GitHub или своя страница. */
    href: text('href'),
    source: text('source').notNull().default('manual'), // 'manual' | 'github'
    externalId: text('external_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('changelog_ext_idx').on(t.externalId), index('changelog_at_idx').on(t.at)],
)

export type ChangelogEntryRow = typeof changelogEntries.$inferSelect

// ── Фоновые задачи (durable-очередь поверх Postgres) ──────────────────
// Воркер тянет задачи `FOR UPDATE SKIP LOCKED` (безопасно между инстансами),
// при ошибке — ретрай с backoff (run_at в будущем), после max_attempts → failed.
export const jobStatus = pgEnum('job_status', ['pending', 'processing', 'done', 'failed'])
// selfgen — самогенерация: специалист сам пишет черновик списка по своей теме
// (инициатива компании, а не ответ на запрос пользователя).
// Список типов задач нужен И в типах, И в рантайме: по нему воркер на старте проверяет,
// что у КАЖДОГО типа есть обработчик. Иначе забытая регистрация видна только в проде и
// только по failed-задачам — так уехал `gnome_task` (задачи ставились, обработчика не было).
export const JOB_TYPES = [
  'email',
  'generate',
  'reindex',
  'push',
  'digest',
  'gardener',
  'moderate',
  'triples',
  'linkcheck',
  'selfgen',
  'gnome_review',
  'gnome_task',
  'feedpull',
  'changelog',
  'partners',
  'finance',
  'chronicle',
] as const
export type JobType = (typeof JOB_TYPES)[number]

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
    // Похороны состоялись: фича узнала о смерти задачи и закрыла своё видимое «в процессе».
    // Признак ПЕРСИСТЕНТНЫЙ намеренно — иначе потеря финализации необратима: моргнула база
    // или процесс убили между пометкой 'failed' и вызовом финализатора, а reaper выбирает
    // только 'processing' и мёртвую задачу больше никому не предложит (находка авто-ревью
    // по #637). Пусто у типов без финализатора — их никто и не выбирает.
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    // Сколько раз пробовали похоронить. Без предела стабильно падающий финализатор
    // (сущность удалена, БД не отвечает) перезывался бы КАЖДУЮ минуту вечно. Так же
    // устроено у зрелых очередей: Oban Lifeline при исчерпанных попытках метит задачу
    // 'discarded', а не возвращает в очередь; River rescuer либо перезапускает, либо
    // отбрасывает по максимуму попыток. Достигли потолка — сдаёмся с записью в Sentry.
    finalizeAttempts: integer('finalize_attempts').notNull().default(0),
    // ПУЛЬС живого исполнителя: воркер обновляет его, пока держит задачу. Без пульса reaper
    // отличает «процесс умер» от «работа долгая» только щедрым таймаутом (30 мин) — и всё это
    // время экран показывает работу, которой давно нет. С пульсом смерть видна за минуту, а
    // честная долгая задача (совет ≈ 9.5 вызовов модели) не отбирается вовсе. Пусто у задач,
    // взятых версией без пульса, — для них остаётся прежний щедрый порог.
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Индекс под выборку готовых к запуску pending-задач.
    ready: index('jobs_ready_idx').on(t.status, t.runAt),
    // Под добор незакрытых похорон: узкий частичный индекс вместо скана всей таблицы задач.
    unfinalized: index('jobs_unfinalized_idx')
      .on(t.type, t.updatedAt)
      .where(sql`status = 'failed' AND finalized_at IS NULL`),
    // Под уборку терминальных: сканировать всю таблицу ради «что удалить» незачем.
    terminal: index('jobs_terminal_idx')
      .on(t.status, t.updatedAt)
      .where(sql`status in ('done','failed')`),
  }),
)

// ── Фундамент автономии: реестр петель + журнал действий ─────────────
// Появилось вместе с самогенерацией: с этого момента петля тратит деньги БЕЗ человека,
// а рубильника на конкретную петлю не было — только глобальное «выключить весь ИИ» или
// режим обслуживания. Здесь ровно то, чего не хватало: пауза, сухой прогон, автоматический
// предохранитель и след «сигнал → решение → действие → результат».

/**
 * Политика петли. Строка на тип джобы, которая работает сама (садовник, самогенерация,
 * рудник знаний, проверка ссылок, дайджест).
 *
 * pausedAt — РУЧНОЙ рубильник (человек увидел неладное и остановил).
 * circuitTrippedAt — АВТОМАТИЧЕСКИЙ предохранитель (сорвалась скорость расхода/ошибок).
 * Это разные вещи, и их нельзя сливать в один флаг: первый снимает человек, второй —
 * восстановление показателей. Обе колонки участвуют в claimJob: пока стоит любая, задачи
 * этого типа не выдаются воркеру.
 */
export const agentLoops = pgTable('agent_loops', {
  // Совпадает с JobType петли — так claimJob фильтрует по одному полю без маппинга.
  type: text('type').primaryKey(),
  pausedAt: timestamp('paused_at', { withTimezone: true }),
  pausedBy: uuid('paused_by').references(() => users.id, { onDelete: 'set null' }),
  pauseReason: text('pause_reason').notNull().default(''),
  // Сухой прогон: петля считает и пишет в журнал, но НЕ производит действий. Обязателен
  // перед включением автономии — иначе первое наблюдение делается уже на живых данных.
  dryRun: boolean('dry_run').notNull().default(false),
  circuitTrippedAt: timestamp('circuit_tripped_at', { withTimezone: true }),
  circuitReason: text('circuit_reason').notNull().default(''),
  // Когда человек в последний раз снял предохранитель. Серия ошибок считается ПОСЛЕ
  // этой отметки: без неё сброс не работал — те же пять записей оставались последними,
  // и первый же проход после снятия срывал предохранитель заново.
  circuitResetAt: timestamp('circuit_reset_at', { withTimezone: true }),
  // Версия правил. Пишется в каждое действие журнала: без неё через полгода нельзя
  // ответить, по каким порогам петля тогда решала. Бампится при правке политики.
  policyVersion: integer('policy_version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Журнал действий агента: сигнал → решение → действие → результат.
 *
 * Пишется В ОДНОЙ ТРАНЗАКЦИИ с самим действием — иначе «сделал» и «записал, что сделал»
 * расходятся, и именно на таком расхождении разбор инцидента и застревает. Внешние
 * трейс-хранилища этого дать не могут (сэмплирование, retention), а Postgres у нас уже есть.
 *
 * principalMode различает «действовал сам» и «действовал за пользователя» — без него
 * нельзя ответить, была ли операция автономной; это признанный пробел, который ни один
 * стандарт агентской идентичности пока не закрывает.
 */
export const agentActions = pgTable(
  'agent_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    loop: text('loop').notNull(), // тип петли (или 'manual' — запуск человеком)
    /** Служебный аккаунт, от чьего имени шло действие (ADR-0004). */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** id в ростере — «какой именно специалист» (аккаунт может быть переиспользован). */
    agentId: text('agent_id').notNull().default(''),
    principalMode: text('principal_mode').notNull().default('autonomous').$type<'autonomous' | 'on_behalf_of'>(),
    /** Что запустило: расписание, сигнал, кнопка человека. */
    signal: jsonb('signal').notNull().default({}),
    /** Что решили и почему (включая отвергнутые варианты, если были). */
    decision: jsonb('decision').notNull().default({}),
    /** Что сделали: 'list.draft', 'suggestion.open', 'noop' … */
    action: text('action').notNull(),
    resultStatus: text('result_status').notNull().$type<'ok' | 'skipped' | 'error' | 'dry-run'>(),
    /** Ссылка на созданное (handle/slug, id правки) — чтобы след вёл к результату. */
    resultRef: text('result_ref').notNull().default(''),
    error: text('error').notNull().default(''),
    policyVersion: integer('policy_version').notNull().default(1),
    /**
     * Ключ идемпотентности: повторный прогон с тем же ключом не должен породить второе
     * действие. Уникальный индекс — единственная надёжная защита; проверка «а нет ли уже»
     * в коде проигрывает гонке двух воркеров.
     */
    idempotencyKey: text('idempotency_key'),
  },
  (t) => [
    index('agent_actions_loop_idx').on(t.loop, t.occurredAt.desc()),
    index('agent_actions_agent_idx').on(t.agentId, t.occurredAt.desc()),
    uniqueIndex('agent_actions_idem_idx').on(t.idempotencyKey),
  ],
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
  // Номер в рамках списка (#12), как у задач: адресуемость и ссылки в тексте.
  // Nullable — строки, созданные до введения поля (бэкфилл проставит).
  number: integer('number'),
  status: suggestionStatus('status').notNull().default('open'),
  // Черновик: правка ещё не предъявлена к слиянию (draft PR у GitHub, WIP: у Gitea).
  // Отдельным полем, а не значением status: черновик — это ОТКРЫТАЯ правка, у которой
  // просто закрыт путь к слиянию, и после снятия она не меняет свою историю статусов.
  draft: boolean('draft').notNull().default(false),
  // Метки и этап — ТА ЖЕ модель, что у задач (labels: jsonb-массив ярлыков,
  // milestone_id → milestones): благодаря совпадению формы к правкам подходят
  // готовые LabelEditor/этапы, а не их копии.
  labels: jsonb('labels').notNull().default([]).$type<string[]>(),
  milestoneId: uuid('milestone_id').references(() => milestones.id, { onDelete: 'set null' }),
  // Соавторы: кто, кроме открывшего, правил пункты. У ветки вклад и так виден в
  // авторстве коммитов, а у предложений с items он не оставался НИГДЕ — правка
  // просто перезаписывала колонку. Массив id, а не таблица: порядок не нужен,
  // связей нет, а запрос всегда идёт вместе с самим предложением.
  coauthorIds: jsonb('coauthor_ids').notNull().default([]).$type<string[]>(),
  /**
   * Обсуждение заперто: новые реплики запрещены (аналог Lock conversation).
   *
   * Нужен, когда спор ушёл в сторону, а правка уже решена: закрывать её ради
   * тишины неправильно — решение и обсуждение это разные вещи. Кто запер,
   * хранится рядом: «заперто» без имени выглядит как поломка, а не как решение.
   */
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedById: uuid('locked_by_id').references(() => users.id, { onDelete: 'set null' }),
  note: text('note').notNull().default(''),
  baseVersion: integer('base_version').notNull(),
  items: jsonb('items').notNull().default([]).$type<ProposedItem[]>(),
  // A3 (PR-модель): PR = «ветка → main». Задан branch_ref → items пустые,
  // предлагаемые шаги материализуются из tip ветки (gitCore.branchSnapshot).
  branchRef: text('branch_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  // Версия, которой предложение стало при слиянии. Нужна откату: без неё «что
  // именно внесла эта правка» приходится угадывать по времени и тексту заметки.
  // Пусто у принятых ДО появления отката — им он и не предлагается.
  mergedVersion: integer('merged_version'),
  // Откат — это НОВОЕ предложение, отменяющее старое (как Revert у GitHub), а не
  // тихая правка истории. Связь видна с обеих сторон: «отменяет #7» / «отменено в #9».
  revertOfId: uuid('revert_of_id'),
}, (t) => [
  index('suggestions_tpl_idx').on(t.templateId, t.status),
  uniqueIndex('suggestions_tpl_number').on(t.templateId, t.number),
  // Одно ОТКРЫТОЕ предложение на ветку — правилом БД, а не проверкой в коде.
  // Проверка «нет ли уже такого» и вставка — два шага, между ними влезает
  // параллельный запрос, и на одну ветку появляются два открытых предложения с
  // разными номерами. Ф4 добавила второй вход (магический пуш), и полагаться на
  // удачу стало нельзя. Частичный индекс: закрытые не мешают открыть новое
  // предложение на ту же ветку, а branch_ref is not null не трогает правки из
  // пунктов (авто-ревью fe#636).
  uniqueIndex('suggestions_open_branch')
    .on(t.templateId, t.branchRef)
    .where(sql`status = 'open' and branch_ref is not null`),
])

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
    // Снятое ревью НЕ удаляется: «правки запрошены и сняты мейнтейнером» — часть
    // истории решения. Удаление выглядело бы так, будто рецензент и не высказывался.
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedById: uuid('dismissed_by_id').references(() => users.id, { onDelete: 'set null' }),
    // Причина обязательна: снятие чужого голоса без объяснения — тихий обход ревью.
    dismissReason: text('dismiss_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sug_review_one_per_reviewer').on(t.suggestionId, t.reviewerId)],
)

// Исполнители правки — форма как у issue_assignees (пара «правка + человек»,
// уникальная): позволяет переиспользовать AssigneePicker, параметризованный экшеном.
export const suggestionAssignees = pgTable(
  'suggestion_assignees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    suggestionId: uuid('suggestion_id')
      .notNull()
      .references(() => suggestions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sug_assignee_uniq').on(t.suggestionId, t.userId)],
)

// ── Запрос ревью (кого ПОПРОСИЛИ посмотреть) ─────────────────────────
// Отдельно от suggestion_reviews: там ВЕРДИКТ (уже посмотрел), тут ПРОСЬБА (ещё нет).
// Смешивать нельзя — иначе «запросили ревью» невозможно отличить от «отревьюил
// без вердикта», а именно на этом различии стоит уведомление и гейт готовности.
export const suggestionReviewRequests = pgTable(
  'suggestion_review_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    suggestionId: uuid('suggestion_id')
      .notNull()
      .references(() => suggestions.id, { onDelete: 'cascade' }),
    // Кого просят.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Кто попросил (для истории действий).
    requestedById: uuid('requested_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sug_review_req_uniq').on(t.suggestionId, t.userId)],
)

// ── Внешние проверки предложения (наш аналог status checks) ──────────
// Их присылает агент/CI снаружи через MCP: у нас самих нет прогонов чужого кода,
// зато у интеграций они есть. Ключ — ПАРА (предложение, имя проверки), как context
// у GitHub: повторный отчёт той же проверки ПЕРЕЗАПИСЫВАЕТ прежний, иначе на
// странице копились бы «tests: fail, tests: ok, tests: fail» без понятного текущего.
export const suggestionReportedChecks = pgTable(
  'suggestion_reported_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    suggestionId: uuid('suggestion_id')
      .notNull()
      .references(() => suggestions.id, { onDelete: 'cascade' }),
    // Имя проверки в отчёте («tests», «lint», «build») — оно же ключ обновления.
    name: text('name').notNull(),
    // 'ok' | 'warn' | 'fail' | 'neutral' | 'pending' — те же статусы, что у своих
    // проверок, плюс pending: длинный прогон отчитывается дважды.
    status: text('status').notNull(),
    summary: text('summary'),
    // Куда смотреть подробности (лог прогона). Может отсутствовать.
    url: text('url'),
    // РЕВИЗИЯ, которую проверяли: tip ветки или отпечаток предложенных пунктов.
    // Без неё «ок» жил вечно: автор дописывал предложение после зелёного отчёта и
    // сливал непроверенное. Не совпала с текущей — отчёт устарел.
    revision: text('revision'),
    // Кто отчитался: проверку видно как чужую, и снять её может только он.
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sug_reported_check_uniq').on(t.suggestionId, t.name)],
)

export type SuggestionReportedCheck = typeof suggestionReportedChecks.$inferSelect

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
// владелец. На issue хранятся ключом `c:<id>` (см. shared/lib/labels).
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
// needsHuman/needsHumanAsk — пометка «здесь нужен человек» из генерации: доезжает до
// принятого списка, иначе честное признание модели теряется на пути кандидат → список.
export type CandidateItem = { title: string; desc: string; command: string; subtasks: string[]; section?: string; level?: StepLevel; why?: string; refs?: { label: string; url: string }[]; needsHuman?: boolean; needsHumanAsk?: string }

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
    // КАКОЙ кандидат стал списком. Без этого «родословная принятого списка» неопределима:
    // кандидатов у витка несколько, у каждого свой провенанс, а связь была только с витком
    // целиком — то есть после принятия было известно «список родился здесь», но не «вот из
    // этого черновика и вот такого разбора критика».
    chosenIdx: integer('chosen_idx'),
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
/**
 * ИСТОЧНИКИ КОРПУСА — что компании РАЗРЕШЕНО брать, с лицензией и атрибуцией.
 *
 * Правило владельца: только CC-BY/CC0/open-access, лицензия и цитируемость фиксируются НА
 * ИСТОЧНИК. Реестр — то место, где это правило перестаёт быть пожеланием: материал попадает
 * в корпус только через запись здесь, а запись невозможна без разрешённой лицензии
 * (проверка fail-closed в shared/ai/source-license).
 *
 * Адрес уникален: один источник — одна запись, повторная регистрация обновляет описание, а
 * не плодит дубли с разными лицензиями (иначе «какая из них настоящая» решить нечем).
 */
/**
 * ПОДПИСКИ НА ПОТОК — источник свежего материала для живых списков (лент).
 *
 * Подписку добавляет ЧЕЛОВЕК и сам указывает тему: угадывать тематику по домену мы не будем —
 * ровно та же логика, что с лицензией источника. Цена ошибки здесь чужие права и мусор в
 * библиотеке, а не неудобство.
 *
 * Тело статей НЕ храним (и не будем): новости не под свободной лицензией, копировать их текст
 * нельзя. Нужен факт события и адрес — формулировку специалист пишет сам, источник остаётся
 * сноской (tracks/living-lists.md).
 */
export const feedSources = pgTable(
  'feed_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Адрес потока: RSS, Atom или JSON Feed — формат определяется по содержимому. */
    url: text('url').notNull(),
    title: text('title').notNull().default(''),
    /** Тема подписки: теги, по которым материал попадёт к профильному специалисту. */
    tags: text('tags').array().notNull().default([]),
    /** Как часто тянуть. Реже — дешевле и вежливее к источнику. */
    everyHours: integer('every_hours').notNull().default(6),
    enabled: boolean('enabled').notNull().default(true),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    /** Когда тянули в последний раз и что вышло — чтобы петля не молчала о сбоях. */
    lastPulledAt: timestamp('last_pulled_at', { withTimezone: true }),
    lastError: text('last_error').notNull().default(''),
    lastItems: integer('last_items').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('feed_sources_url_idx').on(t.url)],
)

/**
 * ЭЛЕМЕНТЫ ПОТОКА — то, из чего специалист выбирает, о чём написать.
 *
 * Уникальность по ключу дедупа (адрес без метокотслеживания): один материал приходит в двух
 * лентах с разными utm — по сырому адресу он выглядел бы двумя новостями.
 *
 * `used_at` отмечает, что материал уже пошёл в список: без этой отметки петля будет
 * пережёвывать одно и то же, а лента — повторяться.
 */
export const feedItems = pgTable(
  'feed_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => feedSources.id, { onDelete: 'cascade' }),
    /** Ключ дедупа (см. shared/ai/feed-parse.feedItemKey). */
    key: text('key').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    /** Короткая подсказка из потока — для ОТБОРА, не для публикации. */
    hint: text('hint').notNull().default(''),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    tags: text('tags').array().notNull().default([]),
    /** Уже использован в списке — второй раз не предлагаем. */
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedTemplateId: uuid('used_template_id').references(() => templates.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('feed_items_key_idx').on(t.key), index('feed_items_fresh_idx').on(t.usedAt, t.publishedAt)],
)

/**
 * ПОВЕСТКА РАЗВИТИЯ — «что растим и почему», единственный объект, где компания смотрит на
 * себя целиком.
 *
 * Пункт рождает петля партнёров из ЧИСЕЛ (покрытие, спрос, качество, свежесть), а судьбу ему
 * назначает человек: одобрено → производство берёт как приоритет; отклонено → больше не
 * предлагаем. Без одобрения не происходит ничего — предлагает компания, решает гендиректор.
 *
 * `why` хранит числа, из которых пункт вырос, а не формулировку: «списков по теме 1 при пороге
 * 5» проверяемо, «нужно усилить направление» — нет.
 */
export const agendaItems = pgTable(
  'agenda_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Класс работы: deepen | canon | hire | demand | quality | feed (shared/agents/agenda). */
    kind: text('kind').notNull(),
    /** Тема/домен; '' — общефирменный пункт. */
    domain: text('domain').notNull().default(''),
    /** Ключ дедупа kind:domain — один пункт на пару, иначе повестка растёт каждый проход. */
    key: text('key').notNull(),
    /** Вес класса × сила сигнала. */
    score: real('score').notNull().default(0),
    why: jsonb('why').notNull().default({}).$type<Record<string, number | string>>(),
    status: text('status').notNull().default('proposed').$type<'proposed' | 'approved' | 'dismissed' | 'done'>(),
    /**
     * ХОЗЯИН РАБОТЫ — один специалист, отвечающий за пункт от начала до конца.
     *
     * «Один владелец на задачу: имя, а не отдел» из докладной. До сих пор у длинной работы
     * ответственного не было вовсе: производство брало тему из повестки, но спросить за неё
     * было не с кого — журнал помнил лишь того, кто выполнил очередной такт.
     *
     * Ставится при ОДОБРЕНИИ: пока пункт не одобрен, назначать некого — работы ещё нет.
     */
    ownerExpertId: text('owner_expert_id'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Уникальность по ключу: повторный проход ОБНОВЛЯЕТ пункт, а не плодит копии. Решение
    // человека (approved/dismissed) при этом сохраняется — см. службу партнёров.
    uniqueIndex('agenda_items_key_idx').on(t.key),
    index('agenda_items_status_idx').on(t.status, t.score),
  ],
)

export const knowledgeSources = pgTable(
  'knowledge_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    url: text('url').notNull(),
    title: text('title').notNull().default(''),
    /** Нормализованный код: CC0 | PUBLIC-DOMAIN | CC-BY | CC-BY-SA | MIT | APACHE-2.0. */
    license: text('license').notNull(),
    /** Кого указывать. Обязательна там, где её требует лицензия (проверяется до вставки). */
    attribution: text('attribution').notNull().default(''),
    /** Заметка человека: что именно взято и зачем. */
    note: text('note').notNull().default(''),
    /** Кто зарегистрировал — служебный аккаунт или человек через ассистента. */
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('knowledge_sources_url_idx').on(t.url)],
)

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

/**
 * ЧЕРНОВИКИ СОВЕТА — сырьё для замера многогранности.
 *
 * Смысл совета (решение владельца) — не добротность, а РАЗНЫЕ УГЛЫ ЗРЕНИЯ. Проверить это
 * можно только сравнив черновики экспертов с финальным сведением: сколько своих граней
 * принёс каждый и сколько из них старейшина потерял при синтезе. До сих пор ответить было
 * НЕЧЕМ: черновики жили в памяти одного вызова и выбрасывались, в generation_messages
 * оставалась только театральная реплика («набрасывает список…»).
 *
 * Отдельная таблица, а не JSONB кандидата: провенанс уезжает клиенту вместе с кандидатом,
 * и полные черновики раздували бы каждый ответ. Здесь они server-only.
 *
 * Анонимность синтеза этим НЕ нарушается: критик и старейшина по-прежнему получают только
 * буквы (A/B/C), а соответствие «буква → автор» лежит рядом, для людей и для замера.
 */
export const generationDrafts = pgTable(
  'generation_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    generationId: uuid('generation_id')
      .notNull()
      .references(() => generations.id, { onDelete: 'cascade' }),
    /** Индекс кандидата витка (совпадает с generation_candidates.idx). */
    idx: integer('idx').notNull().default(0),
    /** Буква анонимного черновика в промпте критика/синтезатора ('A', 'B', …). */
    letter: text('letter').notNull(),
    /** Автор: id эксперта из ростера либо 'innovator'. */
    who: text('who').notNull(),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('generation_drafts_gen_idx').on(t.generationId, t.idx)],
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
    // ПРОФЕССИЯ отдельно от ИМЕНИ (решение владельца): имя — своё, профессия —
    // буквальная («повар», «девопс») и уезжает в ПРОФИЛЬ аккаунта как должность.
    // Пусто → профессией считаем имя (так было исторически: name_en='Chef').
    professionEn: text('profession_en').notNull().default(''),
    professionRu: text('profession_ru').notNull().default(''),
    /**
     * ВЛАДЕЛЕЦ личного специалиста. null = общий (виден всем), иначе — приватный
     * специалист этого пользователя: своя профессия, своя персона, свой корпус.
     *
     * ЧЕКПОИНТ ПРИВАТНОСТИ №1: этот столбец обязан фильтровать ВСЕ пути — ростер,
     * поиск прецедентов, память. Промах в одном месте = утечка между пользователями,
     * поэтому проверяется тестом «чужой личный мир не виден», а не глазами.
     */
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    // Аккаунт специалиста уровня пользователя (ADR-0004: помечен account_type='agent').
    // Через него он ведёт СВОИ списки по темам, комментирует и предлагает правки —
    // наравне с людьми, а не из админки. null = аккаунт ещё не заведён.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
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
    // ЖИЗНЕННЫЙ ЦИКЛ (решение владельца): active → dormant (простаивает, всё сохранено)
    // → archived (год без запросов). Архив — НЕ удаление: персона, опыт и репутация
    // остаются, специалист мгновенно возвращается «как выпускник». Причина архивации не
    // в вычислениях (простой на событийной модели ~бесплатен), а в том, чтобы действующий
    // состав оставался обозримым для маршрутизации.
    // Ортогонально enabled: enabled — рубильник админа, lifecycle — состояние карьеры.
    // 'idle' — стадия ПОД РИСКОМ между активностью и сном: специалист не падает в сон
    // молча, сначала он идёт первым в очереди на работу (см. shared/ai/activation.ts).
    lifecycle: text('lifecycle').notNull().default('active').$type<'active' | 'idle' | 'dormant' | 'archived'>(),
    // МЕСТО В КОМПАНИИ. Гендиректор — владелец (человек), в ростере его нет.
    //   partner    — партнёр-старейшина: методология, качество, повестка. Не домен-эксперт.
    //   chief      — начальник гильдии: зонтик над специализациями, созывает своих.
    //   manager    — менеджер задачи: ведёт одну работу от начала до конца.
    //   expert     — профильный специалист (и он же садовник по своей теме).
    //   backoffice — бухгалтер, HR, аналитик моделей, библиотекарь, летописец.
    // Зачем колонка: совет обязан звать ЭКСПЕРТОВ, а не бухгалтера. Без разделения
    // бэк-офис попадал бы в пул созыва и писал черновики списков (см. getRoster).
    orgRole: text('org_role').notNull().default('expert').$type<'partner' | 'chief' | 'manager' | 'expert' | 'backoffice'>(),
    // ТИР МАСТЕРСТВА — лестница по профессии: у программиста джун/мидл/сеньор, у повара
    // commis→шеф, у части профессий её нет вовсе (плоско). Поэтому свободный текст, а не
    // enum. Пусто = плоская профессия. Ортогонален выводимому званию (gnomeRank считает
    // его по числу принятых работ) — тут именно квалификация, а не выслуга.
    tier: text('tier').notNull().default(''),
    // «МЕЧТЫ» — канал «чего мне не хватает» от специалиста в фиче-бэклог владельца.
    // Не служебная заметка: это сигнал развития продукта со стороны исполнителя.
    dreams: text('dreams').notNull().default(''),
    sort: integer('sort').notNull().default(0),
    // Дата найма. Была нужна дашборду («новых профессий за период») и до сих пор
    // показывалась как честное «нет источника»: updatedAt для этого не годится — он
    // меняется при любой правке персоны, и рост штата им не измерить.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
    /**
     * КТО расходовал: id специалиста в ростере ('chef', 'devops'). Раньше здесь была
     * только модель, поэтому здоровье считалось по model id, а «сколько тратит этот
     * специалист» и «какая модель ему подходит» ответить было нельзя — вопросы про
     * инструмент и про мастера сливались в один. Пусто = вызов не от специалиста.
     */
    gnomeId: text('gnome_id').notNull().default(''),
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
// ── Review-комментарии к пункту внутри ПРЕДЛОЖЕНИЯ (PR) ──────────────
// Живут ТОЛЬКО в предложении, как review-комментарии в pull request: при обычном
// просмотре списка их нет (в GitHub при чтении кода комментировать тоже нельзя —
// только во вкладке Files changed и в Conversation).
//
// Тред — единица обсуждения и разрешения (модель PullRequestReviewThread).
// Якорь file-relative: блок опознаётся стабильным block_id, место внутри блока —
// W3C-селекторами (exact/prefix/suffix + start/end). Индекс строки внутри диффа
// (position у GitHub) не реализуем: он хрупок и помечен deprecated самим GitHub.
//
// Храним ТОЛЬКО исходный якорь и вмороженный снимок текста. Текущее состояние
// («привязан / перепривязан N% / потерян») считается на рендере против
// предложенных пунктов — как дешёвая проверка active? у GitLab, только без
// колонок, которые пришлось бы синхронизировать и которые всё равно устаревают.
export const blockCommentThreads = pgTable(
  'block_comment_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    suggestionId: uuid('suggestion_id')
      .notNull()
      .references(() => suggestions.id, { onDelete: 'cascade' }),
    /** Стабильная идентичность блока (steps.block_id) — переживает версии. */
    blockId: uuid('block_id').notNull(),
    /** Поле блока: 'title' | 'desc' | 'why' | 'command' | 'content.md'. */
    field: text('field').notNull().default('desc'),
    /** Версия, на которой тред заведён (для контекста в Conversation). */
    createdVersion: integer('created_version').notNull(),
    /** Иммутабельный якорь «как было сказано» (W3C-селекторы). */
    anchorOriginal: jsonb('anchor_original').notNull().$type<Record<string, unknown>>(),
    /** Вмороженный текст поля на момент создания — контекст треда навсегда. */
    contextSnapshot: text('context_snapshot').notNull().default(''),
    /**
     * Язык, на котором снят `contextSnapshot`.
     *
     * Без него сравнение «устарело ли обсуждение» врало на двуязычных списках:
     * снимок пишется на языке АВТОРА треда, а сверяется с текстом на языке
     * ЗРИТЕЛЯ — переключение ru↔en помечало нетронутый тред устаревшим.
     */
    contextLang: text('context_lang').notNull().default(''),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedById: uuid('resolved_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('bct_sug_idx').on(t.suggestionId), index('bct_block_idx').on(t.blockId)],
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
    // Черновик ревью: замечание написано, но ещё не отправлено. Видно только автору,
    // пока он не отправит ревью пачкой (как «Start a review» у GitHub). Отдельный
    // флаг, а не отдельная таблица: тред, якорь и ответы у черновика те же самые.
    pending: boolean('pending').notNull().default(false),
    /**
     * ПРЕДЛОЖЕННЫЙ ТЕКСТ поля — замечание, которое применяется кнопкой.
     *
     * У GitHub это патч строк файла, и он рассыпается, когда строки уехали. У нас
     * единица — блок с устойчивой идентичностью (ADR-0013), а поле названо в
     * треде, поэтому «применить» — это подстановка значения, а не наложение
     * патча: перенос пункта её не ломает.
     *
     * null — обычное замечание словами. Пустая строка — тоже осмысленное
     * предложение: «здесь ничего не нужно».
     */
    suggestedText: text('suggested_text'),
    /** Когда предложение применили (null — ещё нет). Дважды не применяем. */
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('bc_thread_idx').on(t.threadId)],
)

/**
 * ОТМЕТКА «ПРОСМОТРЕНО» на пункте предложения — как «Viewed» у файла в GitHub.
 *
 * Личная и НЕ общая: это состояние ревьюера («я это уже смотрел»), а не свойство
 * правки. Поэтому ключ — пара (предложение, пункт, зритель), и чужие галочки
 * никому не видны.
 *
 * `atFingerprint` — отпечаток СОДЕРЖИМОГО пункта на момент отметки. Пункт правят
 * дальше, и отметка, поставленная до правки, врала бы. Отпечаток именно пункта,
 * а не sha ветки: иначе любой чужой коммит гасил бы отметки на всех пунктах,
 * включая нетронутые. Не совпало → «просмотрено до изменений», а не галочка.
 */
export const suggestionViewed = pgTable(
  'suggestion_viewed',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    suggestionId: uuid('suggestion_id')
      .notNull()
      .references(() => suggestions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Идентичность блока (ADR-0013) — переживает перестановку пунктов. */
    blockId: text('block_id').notNull(),
    atFingerprint: text('at_fingerprint').notNull().default(''),
    /**
     * Язык, на котором считали отпечаток.
     *
     * Отпечаток берётся с УЖЕ ЛОКАЛИЗОВАННОГО текста, поэтому на двуязычном
     * списке смена языка интерфейса меняла бы его и гасила все отметки разом.
     * Язык не совпал → об устаревании не судим (как у снимка треда).
     */
    atLang: text('at_lang').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sug_viewed_uq').on(t.suggestionId, t.userId, t.blockId)],
)

export type SuggestionViewed = typeof suggestionViewed.$inferSelect

export type BlockCommentThread = typeof blockCommentThreads.$inferSelect
export type BlockComment = typeof blockComments.$inferSelect

export type Suggestion = typeof suggestions.$inferSelect
export type Generation = typeof generations.$inferSelect
export type GenerationCandidate = typeof generationCandidates.$inferSelect
export type AiUsage = typeof aiUsage.$inferSelect
export type ApiToken = typeof apiTokens.$inferSelect
