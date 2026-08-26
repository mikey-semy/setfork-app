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
import type { ReactNode } from 'react'
import { Bot } from 'lucide-react'
import { fetchModels, EMBEDDING_DIM, type ModelOption } from '@/shared/ai/models'
import { getRosterAll, rosterAvatars } from '@/shared/ai/roster'
import { setAiSettings } from '@/features/admin/actions'
import { SearchSettingsForm } from '@/features/admin/SearchSettingsForm'
import { ModelSelect, type Option } from '@/features/admin/ModelSelect'
import { buildOpts, withSavedOption } from '@/features/admin/model-options'
import { modelMeta } from '@/features/admin/model-enrich'
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
import { adminSettingsSections, type AdminSectionId } from '@/features/admin/settings-sections'
import { FormSaveBar } from '@/shared/ui/FormSaveBar'
import { Input } from '@/shared/ui/input'
import { Field } from '@/shared/ui/Field'
import { Alert } from '@/shared/ui/Alert'
import { buttonClass } from '@/shared/ui/button-style'
import { UserLine } from '@/shared/ui/UserLine'

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
  // Запасной провайдер (пусто = выключен) — читается тем же модулем, что решает подмену.
  const { getFallbackProviderId } = await import('@/shared/ai/provider-failover')
  // Каталог и наш опыт независимы — тянем разом, иначе страница ждёт их по очереди.
  // (Валюта нужна мете только для форматирования; у активного провайдера она известна заранее.)
  const [models, meta, fallbackProvider] = await Promise.all([
    fetchModels(),
    modelMeta(aiProv.provider === 'openrouter' ? 'USD' : 'RUB', ru),
    getFallbackProviderId(),
  ])

  const chatOpts = ensure(buildOpts(models.chat, false, lang, models.currency, models.pricesKnown, meta), settings.chatModel)
  // Ростер и галерея встроенных персонажей — читаем на сервере: клиенту не нужен доступ к БД и fs.
  const [rosterRows, gallery, uploaded] = await Promise.all([getRosterAll(), builtinAvatars(), rosterAvatars()])
  // Загруженная картинка идёт готовым URL (imgproxy/диск) — клиент не должен знать про S3-ключи.
  const roster = rosterRows.map((e) => ({ ...e, uploadedUrl: e.avatarUploaded ? uploaded[e.id] : undefined }))
  const fallbackOpts = ensure(buildOpts(models.chat, false, lang, models.currency, models.pricesKnown, meta), settings.fallbackModel)
  // Валюта — из каталога, а не 'USD' константой: эмбеддинги у RU-провайдеров считаются в ₽.
  const embOpts = ensure(buildOpts(models.embedding, true, lang, models.currency, models.pricesKnown, meta), settings.embeddingModel)
  // Что выбранная модель эмбеддингов отдаёт на самом деле — измеренный факт из памяти стенда
  // (пишется обычными вызовами и пробой при сохранении). Не мерили — так и говорим.
  const embedHint =
    meta.get(settings.embeddingModel)?.embed?.hint ??
    t('admin.embedNotMeasured', lang)

  // Заголовки секций — из словаря: те же строки нужны меню админки на других
  // страницах, где этой страницы (и её локальных литералов) нет.
  const T = {
    online: t('admin.sect.online', lang),
    ai: t('admin.sect.ai', lang),
    media: t('admin.sect.media', lang),
    email: t('admin.sect.email', lang),
    push: t('admin.sect.push', lang),
    search: t('admin.sect.search', lang),
    ach: t('admin.sect.achievements', lang),
  }

  // Содержимое секций по id. Подписи, иконки, синонимы для поиска и ПОРЯДОК живут
  // в общем списке (settings-sections) — по нему же строится группа «Настройки
  // инстанса» в меню на остальных страницах админки.
  const content: Record<AdminSectionId, ReactNode> = {
    maintenance: (
        <SettingsSection title={t('adminMaintenance', lang)}>
          <MaintenanceSection initialOn={maintOn} envOverride={maintenanceEnvOverride()} lang={lang} />
        </SettingsSection>
      ),
    online: (
        <SettingsSection
          title={
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-ok" />
              {T.online} <span className="font-mono text-body-sm text-muted">{online.length}</span>
            </span>
          }
        >
          {online.length === 0 ? (
            <p className="text-body text-muted">{ru ? 'Никого онлайн.' : 'No one online.'}</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {/* Пилюля «кто сейчас на сайте»: форма — общий рецепт кнопки, содержимое —
                  общая строка человека. Раньше и то и другое рисовалось здесь руками, и
                  аватар с ником расходились с такими же строками на других экранах. */}
              {online.map((u) => (
                <Link
                  key={u.userId}
                  href={`/${u.handle}`}
                  className={buttonClass({ variant: 'outline', className: 'rounded-full pl-1' })}
                >
                  <UserLine handle={u.handle} avatarUrl={u.avatarUrl} size="sm" />
                </Link>
              ))}
            </div>
          )}
        </SettingsSection>
      ),
    ai: (
        <SettingsSection
          title={T.ai}
          footer={
            /* Ростер уехал на свою страницу: экспертов много, у каждого инструкция в несколько строк —
               в узкой колонке настроек они не помещались. Здесь только вход. */
            <Link
              href="/admin/council"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-body text-ink-2 hover:text-ink"
            >
              <Bot size={14} /> {t('admin.councilHallExpertsInstructions', lang)}
            </Link>
          }
        >

          <form action={setAiSettings} className="flex flex-col gap-5">
            <AiProviderModels
              enabled={settings.enabled}
              provider={aiProv.provider}
              hasKey={hasKeyByProvider}
              maskedKeys={maskedKeys}
              keySources={aiProv.sources}
              fallbackProvider={fallbackProvider}
              yandexFolder={aiProv.yandexFolder}
              searchKeyMasked={maskKey(aiProv.yandexSearchKey)}
              lang={lang}
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
                // Ширина колонки читается из схемы (EMBEDDING_DIM ← halfvec в schema.ts), а что
                // отдаёт конкретная модель — ИЗМЕРЕНО (embed-capability): хинт ниже.
                embedding: t('admin.embeddingModelDim', lang).replace('{n}', String(EMBEDDING_DIM)),
                embeddingHint: embedHint,
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
              hint={t('admin.generationLimitFreeUsers', lang)}
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
              lang={lang}
            />

            <AssistFields v={{ enabled: settings.assistEnabled, audience: settings.assistAudience }} lang={lang} />

            <FormSaveBar lang={lang} />
          </form>
        </SettingsSection>
      ),
    media: (
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
    email: (
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
    push: (
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
    search: (
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
    changelog: (
        <SettingsSection title="Changelog" hint={t('changelogAdminHint', lang)}>
          <ChangelogSettingsForm current={changelogSettings} lang={lang} />
        </SettingsSection>
      ),
    monetization: (
        <SettingsSection title={t('adminMonetization', lang)} hint={t('adminMonetizationIntro', lang)}>
          <MonetizationSettingsForm lang={lang} v={monetization} />
        </SettingsSection>
      ),
    achievements: (
        <SettingsSection
          title={T.ach}
          hint={
            ru
              ? 'Включай/выключай достижения и задавай свою картинку вместо иконки (перетаскиванием). Действует на всех профилях.'
              : 'Enable/disable achievements and set a custom image instead of the icon (drag-and-drop). Applies to all profiles.'
          }
        >
          <AchievementsAdmin initial={achDisplay} lang={lang} />
        </SettingsSection>
      ),
    reindex: <ReindexPanel lang={lang} />,
  }

  // Секции — через SettingsShell (как в настройках пользователя): липкое меню
  // слева со scrollspy-подсветкой активного пункта + поиск по секциям.
  const sections: ShellSection[] = adminSettingsSections(lang).map((s) => ({ ...s, content: content[s.id] }))

  // Своего заголовка у страницы нет: «Админка» уже написана в шапке приложения, а
  // подзаголовок про «хранятся в БД» — рассказ про устройство, а не подпись к экрану.
  // Дублировать название и объяснять внутреннее устройство ради занятого экрана незачем;
  // то же правило, что и в настройках списка: секции сами себя называют, навигация — в меню.
  return (
    <>
      {/* Заголовок страницы для диктора: у этой страницы всё содержимое рисует компонент,
          видимого h1 нет, а без него человек не поймёт, куда попал. */}
      <h1 className="sr-only">{t('adminTitle', lang)}</h1>
      <AdminShell sections={sections} lang={lang} groups={[...adminNavGroups(lang), adminSettingsGroup(lang, sections.map((x) => x.id))]} />
    </>
  )
}
