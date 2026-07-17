import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { getAiSettings, getApiKey, maskKey } from '@/shared/settings/ai'
import { getMediaSettings, maskSecret } from '@/shared/settings/media'
import { getSearchSettings } from '@/shared/settings/search'
import { getEmailSettings } from '@/shared/settings/email'
import { maintenanceEnvOverride, maintenanceFlag } from '@/shared/settings/maintenance'
import { getMonetizationSettings } from '@/shared/settings/monetization'
import { getVapid } from '@/shared/push/vapid'
import { getOnlineUsers } from '@/features/sessions/queries'
import { Avatar } from '@/shared/ui/Avatar'
import Link from 'next/link'
import { Award, BarChart3, Bell, Bot, Coins, Database, Flag, FolderGit2, Mail, MessageSquare, RefreshCw, ScrollText, Search, Shield, Tag, Users, Wrench } from 'lucide-react'
import { fetchModels, type ModelOption } from '@/shared/ai/models'
import { getRosterAll, rosterAvatars } from '@/shared/ai/roster'
import { setAiSettings } from '@/features/admin/actions'
import { SearchSettingsForm } from '@/features/admin/SearchSettingsForm'
import { ModelSelect, type Option } from '@/features/admin/ModelSelect'
import { AiKeyAndSwitch } from '@/features/admin/AiKeyAndSwitch'
import { CouncilFields } from '@/features/admin/CouncilFields'
import { CouncilRoster } from '@/features/admin/CouncilRoster'
import { CreditsWidget } from '@/features/admin/CreditsWidget'
import { MediaSettingsForm } from '@/features/admin/MediaSettingsForm'
import { EmailSettingsForm } from '@/features/admin/EmailSettingsForm'
import { PushSettingsForm } from '@/features/admin/PushSettingsForm'
import { ReindexPanel } from '@/features/admin/ReindexPanel'
import { AchievementsAdmin } from '@/features/admin/AchievementsAdmin'
import { MaintenanceSection } from '@/features/admin/MaintenanceSection'
import { MonetizationSettingsForm } from '@/features/admin/MonetizationSettingsForm'
import { getAchievementDisplay } from '@/features/profile/achievement-config'
import { SettingsShell, type SettingsSection } from '@/features/settings/SettingsShell'

const field = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-hidden'
const lbl = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'

// OpenRouter возвращает отрицательную цену (-1/токен) у авто-роутеров — она «плавающая».
function isVariable(m: ModelOption): boolean {
  return m.promptPrice < 0 || m.completionPrice < 0
}
// Цена, по которой красим и сортируем: для эмбеддингов — prompt, для чата — completion (или prompt).
function priceMetric(m: ModelOption, embedding?: boolean): number {
  if (isVariable(m)) return Number.POSITIVE_INFINITY // «плавающие» — в конец списка
  return embedding ? m.promptPrice : m.completionPrice || m.promptPrice
}
function priceText(m: ModelOption, embedding: boolean, ru: boolean): string {
  if (isVariable(m)) return ru ? 'Плавающая' : 'Variable'
  if (!m.promptPrice && !m.completionPrice) return ru ? 'Бесплатно' : 'Free'
  return embedding ? `$${m.promptPrice.toFixed(2)}` : `$${m.promptPrice.toFixed(2)} / $${m.completionPrice.toFixed(2)}`
}
// Зелёный — дёшево, жёлтый — средне, красный — дорого, серый — плавающая.
function priceClass(metric: number): string {
  if (!Number.isFinite(metric)) return 'text-muted'
  if (metric <= 1) return 'text-ok'
  if (metric <= 10) return 'text-warn'
  return 'text-danger'
}
function buildOpts(models: ModelOption[], embedding: boolean, ru: boolean): Option[] {
  return [...models]
    .sort((a, b) => priceMetric(a, embedding) - priceMetric(b, embedding))
    .map((m) => ({ value: m.id, id: m.id, price: priceText(m, embedding, ru), priceClass: priceClass(priceMetric(m, embedding)) }))
}
function ensure(opts: Option[], current: string): Option[] {
  return current && !opts.some((o) => o.value === current) ? [{ value: current, id: current }, ...opts] : opts
}

/** Встроенные персонажи для галереи — читаем каталог, а не держим список руками:
 *  дорисовали картинку в public/gnomes — она появилась в выборе сама. */
async function builtinAvatars(): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  const { join } = await import('node:path')
  try {
    const files = await readdir(join(process.cwd(), 'public', 'gnomes'))
    return files.filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5)).sort()
  } catch {
    return []
  }
}

export const metadata = { title: 'Admin' }

export default async function AdminPage() {
  await requireAdmin()
  const [lang, settings, apiKey, media, search, email, online, vapid, achDisplay, maintOn, monetization] = await Promise.all([
    getLang(),
    getAiSettings(),
    getApiKey(),
    getMediaSettings(),
    getSearchSettings(),
    getEmailSettings(),
    getOnlineUsers(),
    getVapid(),
    getAchievementDisplay(),
    maintenanceFlag(),
    getMonetizationSettings(),
  ])
  const ru = lang === 'ru'
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const pushValues = { publicKey: vapid.publicKey, subject: vapid.subject, configured: Boolean(vapid.publicKey && vapid.privateKey) }
  const emailValues = {
    host: email.host,
    port: email.port,
    secure: email.secure,
    user: email.user,
    from: email.from,
    passMask: maskSecret(email.pass),
    notifyTo: email.notifyTo,
  }
  const hasKey = Boolean(apiKey)
  const maskedKey = maskKey(apiKey)
  const mediaValues = {
    s3Endpoint: media.s3Endpoint,
    s3Region: media.s3Region,
    s3Bucket: media.s3Bucket,
    s3Prefix: media.s3Prefix,
    s3AccessKey: media.s3AccessKey,
    imgproxyUrl: media.imgproxyUrl,
    cdnUrl: media.cdnUrl,
    useImgproxy: media.useImgproxy,
    s3SecretMask: maskSecret(media.s3SecretKey),
    imgproxyKeyMask: maskSecret(media.imgproxyKey),
    imgproxySaltMask: maskSecret(media.imgproxySalt),
  }
  const models = hasKey ? await fetchModels() : { chat: [], embedding: [] }

  const chatOpts = ensure(buildOpts(models.chat, false, ru), settings.chatModel)
  // Ростер и галерея встроенных персонажей — читаем на сервере: клиенту не нужен доступ к БД и fs.
  const [rosterRows, gallery, uploaded] = await Promise.all([getRosterAll(), builtinAvatars(), rosterAvatars()])
  // Загруженная картинка идёт готовым URL (imgproxy/диск) — клиент не должен знать про S3-ключи.
  const roster = rosterRows.map((e) => ({ ...e, uploadedUrl: e.avatarUploaded ? uploaded[e.id] : undefined }))
  const fallbackOpts = ensure(buildOpts(models.chat, false, ru), settings.fallbackModel)
  const embOpts = ensure(buildOpts(models.embedding, true, ru), settings.embeddingModel)

  const card = 'rounded-lg border border-border bg-surface p-5'

  // Заголовки секций: ровно один двуязычный литерал на строку (i18n-правило),
  // используется и в липком меню, и в карточке.
  const T = {
    online: ru ? 'Сейчас онлайн' : 'Online now',
    ai: ru ? 'Генерация и модели' : 'Generation & models',
    media: ru ? 'Хранилище и изображения' : 'Storage & images',
    email: ru ? 'Почта (SMTP)' : 'Email (SMTP)',
    push: ru ? 'Push-уведомления (Web Push)' : 'Push notifications (Web Push)',
    search: ru ? 'Поиск' : 'Search',
    ach: ru ? 'Достижения профиля' : 'Profile achievements',
  }

  // Секции — через SettingsShell (как в настройках пользователя): липкое меню
  // слева со scrollspy-подсветкой активного пункта + поиск по секциям.
  const sections: SettingsSection[] = [
    {
      id: 'maintenance',
      title: t('adminMaintenance', lang),
      icon: <Wrench size={14} />,
      keywords: ['maintenance', 'ремонт', 'обслуживание', '503'],
      content: (
        <section className={card}>
          <div className="mb-3 font-semibold text-ink">{t('adminMaintenance', lang)}</div>
          <MaintenanceSection initialOn={maintOn} envOverride={maintenanceEnvOverride()} lang={lang} />
        </section>
      ),
    },
    {
      id: 'online',
      title: T.online,
      icon: <Users size={14} />,
      keywords: ['online', 'онлайн', 'presence'],
      content: (
        <section className={card}>
          <div className="mb-3 flex items-center gap-2 font-semibold text-ink">
            <span className="h-2 w-2 rounded-full bg-ok" />
            {T.online} <span className="font-mono text-[12px] text-muted">{online.length}</span>
          </div>
          {online.length === 0 ? (
            <p className="text-[13px] text-muted">{ru ? 'Никого онлайн.' : 'No one online.'}</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {online.map((u) => (
                <Link key={u.userId} href={`/${u.handle}`} className="flex items-center gap-2 rounded-full border border-border bg-surface-2 py-1 pl-1 pr-3 hover:border-border-strong">
                  <Avatar handle={u.handle} avatarUrl={u.avatarUrl} size={24} />
                  <span className="text-[13px] text-ink">{u.handle}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      ),
    },
    {
      id: 'ai',
      title: T.ai,
      icon: <Bot size={14} />,
      keywords: ['ai', 'openrouter', 'model', 'модель', 'генерация', 'температура', 'токены'],
      content: (
        <section className={card}>
          <div className="mb-4 font-semibold text-ink">{T.ai}</div>

          {!hasKey && (
            <div className="mb-5 rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5 text-[13px] text-warn">
              {ru
                ? 'Нет OPENROUTER_API_KEY в .env — генерация и списки моделей недоступны (id можно ввести вручную).'
                : 'No OPENROUTER_API_KEY in .env — generation and model lists are unavailable (id can be typed manually).'}
            </div>
          )}

          <form action={setAiSettings} className="flex flex-col gap-5">
            <AiKeyAndSwitch enabled={settings.enabled} hasKey={hasKey} maskedKey={maskedKey} ru={ru} />

            <div>
              <label className={lbl}>{ru ? 'Модель генерации' : 'Chat model'}</label>
              {chatOpts.length > 0 ? (
                <ModelSelect name="chatModel" defaultValue={settings.chatModel} options={chatOpts} placeholder={ru ? 'Выбери модель' : 'Pick a model'} />
              ) : (
                <input name="chatModel" defaultValue={settings.chatModel} className={`${field} font-mono`} />
              )}
            </div>

            <div>
              <label className={lbl}>{ru ? 'Запасная модель (для дешёвого режима)' : 'Fallback model (cheap mode)'}</label>
              {fallbackOpts.length > 0 ? (
                <ModelSelect name="fallbackModel" defaultValue={settings.fallbackModel} options={fallbackOpts} allowEmpty placeholder="—" />
              ) : (
                <input name="fallbackModel" defaultValue={settings.fallbackModel} className={`${field} font-mono`} />
              )}
            </div>

            <div>
              <label className={lbl}>{ru ? 'Модель эмбеддингов (RAG, 1536-мерная)' : 'Embedding model (RAG, 1536-dim)'}</label>
              {embOpts.length > 0 ? (
                <ModelSelect name="embeddingModel" defaultValue={settings.embeddingModel} options={embOpts} placeholder={ru ? 'Выбери модель' : 'Pick a model'} />
              ) : (
                <input name="embeddingModel" defaultValue={settings.embeddingModel} className={`${field} font-mono`} />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Temperature</label>
                <input type="number" name="temperature" step="any" min="0" max="2" defaultValue={settings.temperature} className={field} />
              </div>
              <div>
                <label className={lbl}>Max tokens</label>
                <input type="number" name="maxTokens" step="1" min="64" max="4000" defaultValue={settings.maxTokens} className={field} />
              </div>
            </div>

            <p className="text-[12px] text-muted">
              {ru
                ? 'Цены в списках — за 1М токенов (prompt/completion). Зелёные дешевле, жёлтые средние, красные дорогие.'
                : 'Prices are per 1M tokens (prompt/completion). Green = cheap, yellow = mid, red = expensive.'}
            </p>

            <div className="space-y-3 rounded-md border border-border bg-surface-2 p-3">
              <div className="text-[13px] font-medium text-ink">{ru ? 'Контроль расходов OpenRouter' : 'OpenRouter cost control'}</div>
              <CreditsWidget ru={ru} />
              <div>
                <label className={lbl}>{ru ? 'Порог авто-fallback ($)' : 'Auto-fallback threshold ($)'}</label>
                <input type="number" name="cheapModeThreshold" step="any" min="0" defaultValue={settings.cheapModeThreshold} className={field} />
                <p className="mt-1.5 text-[12px] text-muted">
                  {ru
                    ? 'Когда остаток упадёт ниже этой суммы — генерация переключится на запасную модель. 0 — выключено.'
                    : 'When the balance drops below this, generation switches to the fallback model. 0 = off.'}
                </p>
              </div>
            </div>

            <CouncilFields
              modelOptions={chatOpts}
              v={{
                enabled: settings.councilEnabled,
                audience: settings.councilAudience,
                maxGnomes: settings.councilMaxGnomes,
                models: settings.councilModels.join(', '),
                webSeek: settings.councilWebSeek,
                clarify: settings.councilClarify,
                maxPerMonth: settings.councilMaxPerMonth,
              }}
              ru={ru}
            />

            <div className="flex justify-end border-t border-border pt-4">
              <button className="rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">
                {ru ? 'Сохранить' : 'Save'}
              </button>
            </div>
          </form>

          {/* Ростер уехал на свою страницу: экспертов много, у каждого инструкция в несколько строк —
              в узкой колонке настроек они не помещались. Здесь только вход. */}
          <div className="mt-6 border-t border-border pt-5">
            <Link
              href="/admin/council"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px] text-ink-2 hover:text-ink"
            >
              <Bot size={14} /> {say('Council hall — experts, instructions, avatars', 'Зал совета — эксперты, инструкции, аватарки')}
            </Link>
          </div>
        </section>
      ),
    },
    {
      id: 'media',
      title: T.media,
      icon: <Database size={14} />,
      keywords: ['s3', 'imgproxy', 'cdn', 'хранилище', 'картинки', 'storage'],
      content: (
        <section className={card}>
          <div className="mb-1 font-semibold text-ink">{T.media}</div>
          <p className="mb-4 text-[13px] text-ink-2">
            {ru
              ? 'S3-совместимое хранилище, imgproxy и CDN. Значения перекрывают .env; пустое поле — берётся из .env.'
              : 'S3-compatible storage, imgproxy and CDN. Values override .env; an empty field falls back to .env.'}
          </p>
          <MediaSettingsForm ru={ru} v={mediaValues} />
        </section>
      ),
    },
    {
      id: 'email',
      title: T.email,
      icon: <Mail size={14} />,
      keywords: ['smtp', 'email', 'почта', 'mail'],
      content: (
        <section className={card}>
          <div className="mb-1 font-semibold text-ink">{T.email}</div>
          <p className="mb-4 text-[13px] text-ink-2">
            {ru
              ? 'Свой SMTP для уведомлений на почту. Значения перекрывают .env; пустое поле — берётся из .env.'
              : 'Your own SMTP for email notifications. Values override .env; an empty field falls back to .env.'}
          </p>
          <EmailSettingsForm ru={ru} v={emailValues} />
        </section>
      ),
    },
    {
      id: 'push',
      title: T.push,
      icon: <Bell size={14} />,
      keywords: ['push', 'vapid', 'web push', 'уведомления'],
      content: (
        <section className={card}>
          <div className="mb-1 font-semibold text-ink">{T.push}</div>
          <p className="mb-4 text-[13px] text-ink-2">
            {ru
              ? 'Фоновые браузерные уведомления через service worker. Свои VAPID-ключи — без сторонних сервисов.'
              : 'Background browser notifications via a service worker. Your own VAPID keys — no third-party service.'}
          </p>
          <PushSettingsForm ru={ru} v={pushValues} />
        </section>
      ),
    },
    {
      id: 'search',
      title: T.search,
      icon: <Search size={14} />,
      keywords: ['search', 'поиск', 'semantic', 'вектор', 'rag'],
      content: (
        <section className={card}>
          <div className="mb-1 font-semibold text-ink">{T.search}</div>
          <p className="mb-4 text-[13px] text-ink-2">
            {ru
              ? 'Режим строки поиска. Семантика и гибрид используют векторный индекс (нужен ключ и индексация); при недоступности — откат на ключевые слова.'
              : 'Search bar mode. Semantic and hybrid use the vector index (needs API key + indexing); falls back to keyword when unavailable.'}
          </p>
          <SearchSettingsForm current={search} ru={ru} />
        </section>
      ),
    },
    {
      id: 'monetization',
      title: t('adminMonetization', lang),
      icon: <Coins size={14} />,
      keywords: ['monetization', 'монетизация', 'affiliate', 'партнёрка', 'donate', 'донат', 'клики', 'просмотры', 'ftc'],
      content: (
        <section className={card}>
          <div className="mb-1 font-semibold text-ink">{t('adminMonetization', lang)}</div>
          <p className="mb-4 text-[13px] text-ink-2">{t('adminMonetizationIntro', lang)}</p>
          <MonetizationSettingsForm lang={lang} v={monetization} />
        </section>
      ),
    },
    {
      id: 'achievements',
      title: T.ach,
      icon: <Award size={14} />,
      keywords: ['achievements', 'достижения', 'бейджи', 'badges'],
      content: (
        <section className={card}>
          <div className="mb-1 font-semibold text-ink">{T.ach}</div>
          <p className="mb-4 text-[13px] text-ink-2">
            {ru
              ? 'Включай/выключай достижения и задавай свою картинку вместо иконки (перетаскиванием). Действует на всех профилях.'
              : 'Enable/disable achievements and set a custom image instead of the icon (drag-and-drop). Applies to all profiles.'}
          </p>
          <AchievementsAdmin initial={achDisplay} ru={ru} />
        </section>
      ),
    },
    {
      id: 'reindex',
      title: t('adminReindexTitle', lang),
      icon: <RefreshCw size={14} />,
      keywords: ['reindex', 'индексация', 'embeddings', 'эмбеддинги'],
      content: <ReindexPanel ru={ru} />,
    },
  ]

  return (
    <>
      <div className="mx-auto flex w-full max-w-[920px] flex-wrap items-end justify-between gap-3 px-6 pt-8">
        <div>
          <h1 className="mb-1 text-[18px] font-bold text-ink">{t('adminTitle', lang)}</h1>
          <p className="text-[13px] text-ink-2">
            {t('adminSubtitle', lang)}
          </p>
        </div>
        {/* Мобилка: ряд разделов не переносим и не сжимаем — он ЕДЕТ горизонтально (свайп),
            край-в-край за счёт -mx-6/px-6. На sm+ — обычный ряд. Паттерн как в TabNav. */}
        <div className="no-scrollbar -mx-6 flex w-full shrink-0 items-center gap-2 overflow-x-auto px-6 sm:mx-0 sm:w-auto sm:px-0">
          <Link
            href="/admin/collections"
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-surface px-4 py-2 text-[13px] font-semibold text-ink hover:border-border-strong"
          >
            <FolderGit2 size={14} /> {ru ? 'Подборки' : 'Collections'}
          </Link>
          <Link
            href="/admin/audit"
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-surface px-4 py-2 text-[13px] font-semibold text-ink hover:border-border-strong"
          >
            <ScrollText size={14} /> {ru ? 'Аудит' : 'Audit'}
          </Link>
          <Link
            href="/admin/usage"
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-surface px-4 py-2 text-[13px] font-semibold text-ink hover:border-border-strong"
          >
            <BarChart3 size={14} /> {ru ? 'Расход на черновики' : 'Draft usage'}
          </Link>
          <Link
            href="/admin/feedback"
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-surface px-4 py-2 text-[13px] font-semibold text-ink hover:border-border-strong"
          >
            <MessageSquare size={14} /> {t('feedback', lang)}
          </Link>
          <Link
            href="/admin/reports"
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-surface px-4 py-2 text-[13px] font-semibold text-ink hover:border-border-strong"
          >
            <Flag size={14} /> {t('reports', lang)}
          </Link>
          <Link
            href="/admin/tags"
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-surface px-4 py-2 text-[13px] font-semibold text-ink hover:border-border-strong"
          >
            <Tag size={14} /> {t('tags', lang)}
          </Link>
          <Link
            href="/admin/moderation"
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg"
          >
            <Shield size={14} /> {ru ? 'Модерация' : 'Moderation'}
          </Link>
        </div>
      </div>
      <SettingsShell sections={sections} lang={lang} />
    </>
  )
}
