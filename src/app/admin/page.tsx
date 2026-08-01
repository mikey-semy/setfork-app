import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { getAiProviderRaw, getAiSettings, maskKey } from '@/shared/settings/ai'
import { getMediaSettings, maskSecret } from '@/shared/settings/media'
import { getChangelogSettings } from '@/shared/settings/changelog'
import { ChangelogSettingsForm } from '@/features/admin/ChangelogSettingsForm'
import { getSearchSettings } from '@/shared/settings/search'
import { getEmailSettings } from '@/shared/settings/email'
import { maintenanceEnvOverride, maintenanceFlag } from '@/shared/settings/maintenance'
import { getMonetizationSettings } from '@/shared/settings/monetization'
import { getVapid } from '@/shared/push/vapid'
import { getOnlineUsers } from '@/features/sessions/queries'
import { Avatar } from '@/shared/ui/Avatar'
import Link from 'next/link'
import { Megaphone } from 'lucide-react'
import { Award, BarChart3, Bell, Bot, Coins, Database, Flag, FolderGit2, LayoutDashboard, Mail, MessageSquare, RefreshCw, Rss, ScrollText, Search, Shield, Tag, TrendingUp, Users, Wrench } from 'lucide-react'
import { fetchModels, EMBEDDING_DIM, type ModelOption } from '@/shared/ai/models'
import { getRosterAll, rosterAvatars } from '@/shared/ai/roster'
import { setAiSettings } from '@/features/admin/actions'
import { SearchSettingsForm } from '@/features/admin/SearchSettingsForm'
import { ModelSelect, type Option } from '@/features/admin/ModelSelect'
import { buildOpts, withSavedOption } from '@/features/admin/model-options'
import { AiProviderModels } from '@/features/admin/AiProviderModels'
import { AssistFields } from '@/features/admin/AssistFields'
import { CouncilFields } from '@/features/admin/CouncilFields'
import { MediaSettingsForm } from '@/features/admin/MediaSettingsForm'
import { EmailSettingsForm } from '@/features/admin/EmailSettingsForm'
import { PushSettingsForm } from '@/features/admin/PushSettingsForm'
import { ReindexPanel } from '@/features/admin/ReindexPanel'
import { AchievementsAdmin } from '@/features/admin/AchievementsAdmin'
import { MaintenanceSection } from '@/features/admin/MaintenanceSection'
import { MonetizationSettingsForm } from '@/features/admin/MonetizationSettingsForm'
import { getAchievementDisplay } from '@/features/profile/achievement-config'
import type { SettingsSection as ShellSection } from '@/features/settings/SettingsShell'
import { SettingsSection } from '@/shared/ui/SettingsSection'
import { AdminShell } from '@/features/admin/AdminShell'
import { adminNavGroups, adminSettingsGroup } from '@/features/admin/nav-groups'
import { FormSaveBar } from '@/shared/ui/FormSaveBar'
import { Input } from '@/shared/ui/input'
import { Field } from '@/shared/ui/Field'
import { Alert } from '@/shared/ui/Alert'

// OpenRouter возвращает отрицательную цену (-1/токен) у авто-роутеров — она «плавающая».
// Общая с серверным экшеном смены провайдера (model-options): две копии этой логики
// и разъехались — экшен свою потерял, и селект после переключения оставался пустым.
const ensure = withSavedOption

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

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('adminTitle', lang) }
}

export default async function AdminPage() {
  await requireAdmin()
  const [lang, settings, aiProv, media, search, email, online, vapid, achDisplay, maintOn, monetization, changelogSettings] = await Promise.all([
    getLang(),
    getAiSettings(),
    getAiProviderRaw(),
    getMediaSettings(),
    getSearchSettings(),
    getEmailSettings(),
    getOnlineUsers(),
    getVapid(),
    getAchievementDisplay(),
    maintenanceFlag(),
    getMonetizationSettings(),
    getChangelogSettings(),
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
  const providerKeys = {
    openrouter: aiProv.openrouterKey,
    selectel: aiProv.selectelKey,
    yandex: aiProv.yandexKey,
    gigachat: aiProv.gigachatKey,
  }
  const hasKeyByProvider = {
    openrouter: Boolean(providerKeys.openrouter),
    selectel: Boolean(providerKeys.selectel),
    yandex: Boolean(providerKeys.yandex && aiProv.yandexFolder),
    gigachat: Boolean(providerKeys.gigachat),
  }
  const maskedKeys = {
    openrouter: maskKey(providerKeys.openrouter),
    selectel: maskKey(providerKeys.selectel),
    yandex: maskKey(providerKeys.yandex),
    gigachat: maskKey(providerKeys.gigachat),
  }
  const hasKey = hasKeyByProvider[aiProv.provider] // активный провайдер сконфигурирован
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
  const models = await fetchModels() // сам вернёт пустой каталог, если провайдер не сконфигурирован

  const chatOpts = ensure(buildOpts(models.chat, false, lang, models.currency, models.pricesKnown), settings.chatModel)
  // Ростер и галерея встроенных персонажей — читаем на сервере: клиенту не нужен доступ к БД и fs.
  const [rosterRows, gallery, uploaded] = await Promise.all([getRosterAll(), builtinAvatars(), rosterAvatars()])
  // Загруженная картинка идёт готовым URL (imgproxy/диск) — клиент не должен знать про S3-ключи.
  const roster = rosterRows.map((e) => ({ ...e, uploadedUrl: e.avatarUploaded ? uploaded[e.id] : undefined }))
  const fallbackOpts = ensure(buildOpts(models.chat, false, lang, models.currency, models.pricesKnown), settings.fallbackModel)
  // Валюта — из каталога, а не 'USD' константой: эмбеддинги у RU-провайдеров считаются в ₽.
  const embOpts = ensure(buildOpts(models.embedding, true, lang, models.currency, models.pricesKnown), settings.embeddingModel)

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
  const sections: ShellSection[] = [
    {
      id: 'maintenance',
      title: t('adminMaintenance', lang),
      icon: <Wrench size={14} />,
      keywords: ['maintenance', 'ремонт', 'обслуживание', '503'],
      content: (
        <SettingsSection title={t('adminMaintenance', lang)}>
          <MaintenanceSection initialOn={maintOn} envOverride={maintenanceEnvOverride()} lang={lang} />
        </SettingsSection>
      ),
    },
    {
      id: 'online',
      title: T.online,
      icon: <Users size={14} />,
      keywords: ['online', 'онлайн', 'presence'],
      content: (
        <SettingsSection
          title={
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-ok" />
              {T.online} <span className="font-mono text-[0.78125rem] text-muted">{online.length}</span>
            </span>
          }
        >
          {online.length === 0 ? (
            <p className="text-[0.8125rem] text-muted">{ru ? 'Никого онлайн.' : 'No one online.'}</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {online.map((u) => (
                <Link key={u.userId} href={`/${u.handle}`} className="flex items-center gap-2 rounded-full border border-border bg-surface-2 py-1 pl-1 pr-3 hover:border-border-strong">
                  <Avatar handle={u.handle} avatarUrl={u.avatarUrl} size={24} />
                  <span className="text-[0.8125rem] text-ink">{u.handle}</span>
                </Link>
              ))}
            </div>
          )}
        </SettingsSection>
      ),
    },
    {
      id: 'ai',
      title: T.ai,
      icon: <Bot size={14} />,
      keywords: ['ai', 'openrouter', 'model', 'модель', 'генерация', 'температура', 'токены'],
      content: (
        <SettingsSection
          title={T.ai}
          footer={
            /* Ростер уехал на свою страницу: экспертов много, у каждого инструкция в несколько строк —
               в узкой колонке настроек они не помещались. Здесь только вход. */
            <Link
              href="/admin/council"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[0.8125rem] text-ink-2 hover:text-ink"
            >
              <Bot size={14} /> {t('admin.councilHallExpertsInstructions', lang)}
            </Link>
          }
        >
          {!hasKey && (
            <Alert variant="warn" className="mb-5">
              {say(
                'The active provider is not configured (no key) — generation and model lists are unavailable (id can be typed manually).',
                'Активный провайдер не сконфигурирован (нет ключа) — генерация и списки моделей недоступны (id можно ввести вручную).',
              )}
            </Alert>
          )}

          <form action={setAiSettings} className="flex flex-col gap-5">
            <AiProviderModels
              enabled={settings.enabled}
              provider={aiProv.provider}
              hasKey={hasKeyByProvider}
              maskedKeys={maskedKeys}
              yandexFolder={aiProv.yandexFolder}
              searchKeyMasked={maskKey(aiProv.yandexSearchKey)}
              ru={ru}
              initial={{
                chat: chatOpts,
                embedding: embOpts,
                chatModel: settings.chatModel,
                fallbackModel: settings.fallbackModel,
                embeddingModel: settings.embeddingModel,
                cheapModeThreshold: settings.cheapModeThreshold,
                currency: models.currency,
                pricesKnown: models.pricesKnown,
                error: models.error,
              }}
              labels={{
                chat: t('admin.chatModel', lang),
                fallback: t('admin.fallbackModelCheapMode', lang),
                // Размерность подставляется из EMBEDDING_DIM: она задана схемой БД (pgvector),
                // и подпись не должна расходиться со схемой из-за числа, набранного в тексте.
                embedding: say(`Embedding model (RAG, ${EMBEDDING_DIM}-dim)`, `Модель эмбеддингов (RAG, ${EMBEDDING_DIM}-мерная)`),
                pick: t('admin.pickModel', lang),
                loading: t('admin.loadingProviderSModels', lang),
                noKey: t('admin.noKeyProviderCatalog', lang),
              }}
            />

            <div className="grid grid-cols-2 gap-3">
              <Field label="Temperature">
                <Input type="number" name="temperature" step="any" min="0" max="2" defaultValue={settings.temperature} />
              </Field>
              <Field label="Max tokens">
                <Input type="number" name="maxTokens" step="1" min="64" max="8000" defaultValue={settings.maxTokens} />
              </Field>
            </div>

            <Field
              label={t('admin.freePlanGenerationsMonth', lang)}
              hint={tr(
                {
                  en: 'Generation limit for free users. 0 = monetization off (no limit). Pro / admin are always unlimited; the council is Pro-only.',
                  ru: 'Лимит генераций для бесплатных. 0 = монетизация выключена (без лимита). Pro/админ — без лимита; «совет» — только Pro.',
                },
                lang,
              )}
            >
              <Input type="number" name="freeMonthlyGens" step="1" min="0" defaultValue={settings.freeMonthlyGens} />
            </Field>

            {/* Подпись про валюту цен и блок контроля расходов переехали в AiProviderModels:
                здесь они рендерились по СОХРАНЁННОМУ провайдеру и врали при переключении. */}

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
                selfGenMode: settings.selfGenMode,
                selfGenPerDay: settings.selfGenPerDay,
                selfGenPerSweep: settings.selfGenPerSweep,
                readinessMode: settings.readinessMode,
                readinessMinSteps: settings.readinessMinSteps,
                readinessMinGrade: settings.readinessMinGrade,
                readinessPerDay: settings.readinessPerDay,
              }}
              ru={ru}
            />

            <AssistFields v={{ enabled: settings.assistEnabled, audience: settings.assistAudience }} ru={ru} />

            <FormSaveBar lang={lang} />
          </form>
        </SettingsSection>
      ),
    },
    {
      id: 'media',
      title: T.media,
      icon: <Database size={14} />,
      keywords: ['s3', 'imgproxy', 'cdn', 'хранилище', 'картинки', 'storage'],
      content: (
        <SettingsSection
          title={T.media}
          hint={
            ru
              ? 'S3-совместимое хранилище, imgproxy и CDN. Значения перекрывают .env; пустое поле — берётся из .env.'
              : 'S3-compatible storage, imgproxy and CDN. Values override .env; an empty field falls back to .env.'
          }
        >
          <MediaSettingsForm lang={lang} v={mediaValues} />
        </SettingsSection>
      ),
    },
    {
      id: 'email',
      title: T.email,
      icon: <Mail size={14} />,
      keywords: ['smtp', 'email', 'почта', 'mail'],
      content: (
        <SettingsSection
          title={T.email}
          hint={
            ru
              ? 'Свой SMTP для уведомлений на почту. Значения перекрывают .env; пустое поле — берётся из .env.'
              : 'Your own SMTP for email notifications. Values override .env; an empty field falls back to .env.'
          }
        >
          <EmailSettingsForm lang={lang} v={emailValues} />
        </SettingsSection>
      ),
    },
    {
      id: 'push',
      title: T.push,
      icon: <Bell size={14} />,
      keywords: ['push', 'vapid', 'web push', 'уведомления'],
      content: (
        <SettingsSection
          title={T.push}
          hint={
            ru
              ? 'Фоновые браузерные уведомления через service worker. Свои VAPID-ключи — без сторонних сервисов.'
              : 'Background browser notifications via a service worker. Your own VAPID keys — no third-party service.'
          }
        >
          <PushSettingsForm lang={lang} v={pushValues} />
        </SettingsSection>
      ),
    },
    {
      id: 'search',
      title: T.search,
      icon: <Search size={14} />,
      keywords: ['search', 'поиск', 'semantic', 'вектор', 'rag'],
      content: (
        <SettingsSection
          title={T.search}
          hint={
            ru
              ? 'Режим строки поиска. Семантика и гибрид используют векторный индекс (нужен ключ и индексация); при недоступности — откат на ключевые слова.'
              : 'Search bar mode. Semantic and hybrid use the vector index (needs API key + indexing); falls back to keyword when unavailable.'
          }
        >
          <SearchSettingsForm current={search} lang={lang} />
        </SettingsSection>
      ),
    },
    {
      id: 'changelog',
      title: 'Changelog',
      icon: <ScrollText size={14} />,
      keywords: ['changelog', 'релизы', 'github', 'история', 'обновления'],
      content: (
        <SettingsSection title="Changelog" hint={t('changelogAdminHint', lang)}>
          <ChangelogSettingsForm current={changelogSettings} lang={lang} />
        </SettingsSection>
      ),
    },
    {
      id: 'monetization',
      title: t('adminMonetization', lang),
      icon: <Coins size={14} />,
      keywords: ['monetization', 'монетизация', 'affiliate', 'партнёрка', 'donate', 'донат', 'клики', 'просмотры', 'ftc'],
      content: (
        <SettingsSection title={t('adminMonetization', lang)} hint={t('adminMonetizationIntro', lang)}>
          <MonetizationSettingsForm lang={lang} v={monetization} />
        </SettingsSection>
      ),
    },
    {
      id: 'achievements',
      title: T.ach,
      icon: <Award size={14} />,
      keywords: ['achievements', 'достижения', 'бейджи', 'badges'],
      content: (
        <SettingsSection
          title={T.ach}
          hint={
            ru
              ? 'Включай/выключай достижения и задавай свою картинку вместо иконки (перетаскиванием). Действует на всех профилях.'
              : 'Enable/disable achievements and set a custom image instead of the icon (drag-and-drop). Applies to all profiles.'
          }
        >
          <AchievementsAdmin initial={achDisplay} ru={ru} />
        </SettingsSection>
      ),
    },
    {
      id: 'reindex',
      title: t('adminReindexTitle', lang),
      icon: <RefreshCw size={14} />,
      keywords: ['reindex', 'индексация', 'embeddings', 'эмбеддинги'],
      content: <ReindexPanel lang={lang} />,
    },
  ]

  // Своего заголовка у страницы нет: «Админка» уже написана в шапке приложения, а
  // подзаголовок про «хранятся в БД» — рассказ про устройство, а не подпись к экрану.
  // Дублировать название и объяснять внутреннее устройство ради занятого экрана незачем;
  // то же правило, что и в настройках списка: секции сами себя называют, навигация — в меню.
  return (
    <AdminShell sections={sections} lang={lang} groups={[...adminNavGroups(lang), adminSettingsGroup(lang, sections.map((x) => x.id))]} />
  )
}
