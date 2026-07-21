'use server'

import { revalidatePath } from 'next/cache'
import { getAdmin, requireAdmin } from '@/shared/auth/admin'
import { saveSettings } from '@/shared/settings/kv'
import { maintenanceFlag, setMaintenance } from '@/shared/settings/maintenance'
import { AI_PROVIDERS, API_KEY_SETTING, GIGACHAT_KEY_SETTING, PROVIDER_SETTING, SELECTEL_KEY_SETTING, YANDEX_FOLDER_SETTING, YANDEX_KEY_SETTING, defaultEmbeddingModel, getAiProviderRaw, hasApiKey, nsKey } from '@/shared/settings/ai'
import { clearMediaCache, MEDIA_KEYS } from '@/shared/settings/media'
import { clearSearchCache, SEARCH_KEYS, SEARCH_MODES, type SearchMode } from '@/shared/settings/search'
import { clearEmailCache, EMAIL_KEYS, emailEnabled } from '@/shared/settings/email'
import { clearMonetizationCache, DEFAULT_AD_MARKING, DEFAULT_DISCLOSURE, MONETIZATION_KEYS, sanitizeDonateUrl } from '@/shared/settings/monetization'
import { parseAffiliateRules } from '@/core'
import { clearVapidCache, VAPID_KEYS } from '@/shared/push/vapid'
import { removeImageFile, uploadImageFile } from '@/shared/media'
import { sendMail } from '@/shared/email/mailer'
import { councilExperts, db, users } from '@/shared/db'
import { eq } from 'drizzle-orm'

export async function setAiSettings(formData: FormData): Promise<void> {
  await requireAdmin()
  const enabled = formData.get('enabled') === 'on'
  const chatModel = String(formData.get('chatModel') ?? '').trim()
  const fallbackRaw = String(formData.get('fallbackModel') ?? '').trim()
  const fallbackModel = fallbackRaw === '__none__' ? '' : fallbackRaw
  const embeddingModel = String(formData.get('embeddingModel') ?? '').trim()
  const temperature = Math.min(2, Math.max(0, Number(formData.get('temperature')) || 0.3))
  // Потолок 8000, а не 4000: длинные списки (рецепты/инвентарь) при 1500 обрезались → 33-56% отказов
  // (research/2026-07-18-council-bench). Прод на 5000; кламп 4000 молча вернул бы поломку при пересохранении.
  const maxTokens = Math.min(8000, Math.max(64, Math.round(Number(formData.get('maxTokens')) || 4000)))
  // Поле порога рендерится только при OpenRouter — отсутствие в форме значит «не менять»,
  // иначе смена провайдера туда-обратно молча обнуляла бы порог.
  const thresholdRaw = formData.get('cheapModeThreshold')
  const cheapModeThreshold = thresholdRaw == null ? null : Math.max(0, Number(thresholdRaw) || 0)
  // Провайдер чата + его ключи. Ключ пишем только если поле заполнено — пусто = «не менять».
  const providerRaw = String(formData.get('provider') ?? '').trim()
  const provider = (AI_PROVIDERS as readonly string[]).includes(providerRaw) ? providerRaw : ''
  const apiKey = String(formData.get('apiKey') ?? '').trim()
  const selectelKey = String(formData.get('selectelKey') ?? '').trim()
  const yandexKey = String(formData.get('yandexKey') ?? '').trim()
  const yandexFolder = String(formData.get('yandexFolder') ?? '').trim()
  const gigachatKey = String(formData.get('gigachatKey') ?? '').trim()

  // «Совет гномов» — мультимодельная генерация за флагами (см. shared/ai/council.ts).
  const councilMaxGnomes = Math.min(8, Math.max(1, Math.round(Number(formData.get('councilMaxGnomes')) || 3)))
  const councilMaxPerMonth = Math.max(0, Math.round(Number(formData.get('councilMaxPerMonth')) || 0))
  const freeMonthlyGens = Math.max(0, Math.round(Number(formData.get('freeMonthlyGens')) || 0))
  const councilModels = String(formData.get('councilModels') ?? '').split(',').map((s) => s.trim()).filter(Boolean).join(',')

  // Модели/порог пишутся в НЕЙМСПЕЙС провайдера из формы (селекты рендерились под
  // него): переключение провайдера не затирает настройки соседей. Легаси-ключи
  // (ai.chat_model, …) больше не пишем — они остаются read-фолбэком openrouter.
  const nsProv = provider || (await getAiProviderRaw()).provider
  const settings: Record<string, string> = {
    [nsKey(nsProv, 'chat_model')]: chatModel, // пусто = дефолт провайдера при чтении
    [nsKey(nsProv, 'fallback_model')]: fallbackModel,
    [nsKey(nsProv, 'council_models')]: councilModels,
    'ai.embedding_model': embeddingModel || defaultEmbeddingModel(),
    'ai.temperature': String(temperature),
    'ai.max_tokens': String(maxTokens),
    'ai.council_enabled': formData.get('councilEnabled') === 'on' ? 'true' : 'false',
    'ai.council_audience': formData.get('councilAudience') === 'all' ? 'all' : 'admin',
    'ai.council_max_gnomes': String(councilMaxGnomes),
    'ai.council_web_seek': formData.get('councilWebSeek') === 'on' ? 'true' : 'false',
    'ai.council_clarify': formData.get('councilClarify') === 'on' ? 'true' : 'false',
    'ai.council_max_per_month': String(councilMaxPerMonth),
    // «Помощь на шаге» (AI-подсказка застрявшему в прогоне) — свой флаг+аудитория.
    'ai.assist_enabled': formData.get('assistEnabled') === 'on' ? 'true' : 'false',
    'ai.assist_audience': formData.get('assistAudience') === 'all' ? 'all' : 'admin',
    'ai.free_monthly_gens': String(freeMonthlyGens),
  }
  if (cheapModeThreshold != null) settings[nsKey(nsProv, 'cheap_mode_threshold')] = String(cheapModeThreshold)
  if (provider) settings[PROVIDER_SETTING] = provider
  if (apiKey) settings[API_KEY_SETTING] = apiKey
  if (selectelKey) settings[SELECTEL_KEY_SETTING] = selectelKey
  if (yandexKey) settings[YANDEX_KEY_SETTING] = yandexKey
  if (yandexFolder) settings[YANDEX_FOLDER_SETTING] = yandexFolder
  if (gigachatKey) {
    settings[GIGACHAT_KEY_SETTING] = gigachatKey
    const { clearGigaChatTokenCache } = await import('@/shared/ai/gigachat-token')
    clearGigaChatTokenCache() // старый Bearer мог быть от прежнего ключа
  }

  // Сначала сохраняем провайдера/ключи, затем проверяем конфиг УЖЕ нового провайдера —
  // «включено» допустимо только когда активный провайдер реально сконфигурирован.
  await saveSettings(settings)
  const keyExists = await hasApiKey()
  await saveSettings({ 'ai.enabled': enabled && keyExists ? 'true' : 'false' })
  revalidatePath('/admin')
}

// ── Хранилище и изображения (S3 + imgproxy + CDN) ────────────────────
export async function setMediaSettings(formData: FormData): Promise<void> {
  await requireAdmin()
  const str = (k: string) => String(formData.get(k) ?? '').trim()

  // Обычные поля пишем всегда (пусто = фолбэк на env при чтении).
  const settings: Record<string, string> = {
    [MEDIA_KEYS.s3Endpoint]: str('s3Endpoint'),
    [MEDIA_KEYS.s3Region]: str('s3Region'),
    [MEDIA_KEYS.s3Bucket]: str('s3Bucket'),
    [MEDIA_KEYS.s3Prefix]: str('s3Prefix'),
    [MEDIA_KEYS.s3AccessKey]: str('s3AccessKey'),
    [MEDIA_KEYS.imgproxyUrl]: str('imgproxyUrl'),
    [MEDIA_KEYS.cdnUrl]: str('cdnUrl'),
    [MEDIA_KEYS.useImgproxy]: formData.get('useImgproxy') === 'on' ? 'true' : 'false',
  }
  // Секреты перезаписываем только если ввели непустое (пусто = оставить как есть).
  const secretKey = str('s3SecretKey')
  if (secretKey) settings[MEDIA_KEYS.s3SecretKey] = secretKey
  const imgKey = str('imgproxyKey')
  if (imgKey) settings[MEDIA_KEYS.imgproxyKey] = imgKey
  const imgSalt = str('imgproxySalt')
  if (imgSalt) settings[MEDIA_KEYS.imgproxySalt] = imgSalt

  await saveSettings(settings)
  clearMediaCache()
  revalidatePath('/admin')
}

// ── Почта (SMTP: свой сервер, без сторонних сервисов) ────────────────
export async function setEmailSettings(formData: FormData): Promise<void> {
  await requireAdmin()
  const str = (k: string) => String(formData.get(k) ?? '').trim()
  const settings: Record<string, string> = {
    [EMAIL_KEYS.host]: str('host'),
    [EMAIL_KEYS.port]: str('port'),
    [EMAIL_KEYS.secure]: formData.get('secure') === 'on' ? 'true' : 'false',
    [EMAIL_KEYS.user]: str('user'),
    [EMAIL_KEYS.from]: str('from'),
    [EMAIL_KEYS.notifyTo]: str('notifyTo'),
  }
  const pass = str('pass')
  if (pass) settings[EMAIL_KEYS.pass] = pass // пусто = не менять
  await saveSettings(settings)
  clearEmailCache()
  revalidatePath('/admin')
}

/** Тест-письмо на указанный адрес (или на email админа). Возвращает результат для UI. */
export async function sendTestEmail(to: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin()
  clearEmailCache() // вдруг настройки только что сохранили
  if (!(await emailEnabled())) return { ok: false, error: 'SMTP не настроен (нет host).' }
  let recipient = to.trim()
  if (!recipient) {
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, admin.userId)).limit(1)
    recipient = u?.email ?? ''
  }
  if (!recipient) return { ok: false, error: 'Нет адреса получателя.' }
  const ok = await sendMail({
    to: recipient,
    subject: 'SetFork — test email',
    html: '<p style="font-family:sans-serif;font-size:15px">SMTP works ✅ — SetFork может отправлять почту.</p>',
  })
  return ok ? { ok: true } : { ok: false, error: 'Отправка не удалась — проверьте host/port/креды.' }
}

// ── Web Push (VAPID: свои ключи, без сторонних сервисов) ─────────────
export async function generateVapidKeys(): Promise<{ ok: true; publicKey: string } | { error: string }> {
  if (!(await getAdmin())) return { error: 'Доступ запрещён.' }
  const webpush = (await import('web-push')).default
  const keys = webpush.generateVAPIDKeys()
  await saveSettings({ [VAPID_KEYS.public]: keys.publicKey, [VAPID_KEYS.private]: keys.privateKey })
  clearVapidCache()
  revalidatePath('/admin')
  return { ok: true, publicKey: keys.publicKey }
}

export async function setPushSubject(formData: FormData): Promise<void> {
  await requireAdmin()
  const subject = String(formData.get('subject') ?? '').trim()
  await saveSettings({ [VAPID_KEYS.subject]: subject })
  clearVapidCache()
  revalidatePath('/admin')
}

// ── Настройки поиска (режим + порог + лимит) ─────────────────────────
export async function setSearchSettings(formData: FormData): Promise<void> {
  await requireAdmin()
  const mode = String(formData.get('mode') ?? '')
  const minScore = Math.min(1, Math.max(0, Number(formData.get('minScore')) || 0))
  const limit = Math.min(100, Math.max(1, Math.round(Number(formData.get('limit')) || 20)))
  await saveSettings({
    [SEARCH_KEYS.mode]: SEARCH_MODES.includes(mode as SearchMode) ? mode : 'hybrid',
    [SEARCH_KEYS.minScore]: String(minScore),
    [SEARCH_KEYS.limit]: String(limit),
  })
  clearSearchCache()
  revalidatePath('/admin')
  revalidatePath('/explore')
}

// ── Монетизация и трафик ─────────────────────────────────────────────
export async function setMonetizationSettings(formData: FormData): Promise<void> {
  const admin = await requireAdmin()
  const rules = parseAffiliateRules(String(formData.get('affiliateRules') ?? '[]'))
  const disclosureText = String(formData.get('disclosureText') ?? '').trim()
  const adMarkingText = String(formData.get('adMarkingText') ?? '').trim()
  const donateUrl = sanitizeDonateUrl(String(formData.get('donateUrl') ?? ''))
  await saveSettings({
    // Храним только отклонения от дефолтов ('' в kv = удалить ключ):
    // дефолт-ВКЛ тумблеры пишутся как 'false', дефолт-ВЫКЛ — как 'true'.
    [MONETIZATION_KEYS.viewTracking]: formData.get('viewTracking') === 'on' ? '' : 'false',
    [MONETIZATION_KEYS.linkTracking]: formData.get('linkTracking') === 'on' ? '' : 'false',
    [MONETIZATION_KEYS.affiliateEnabled]: formData.get('affiliateEnabled') === 'on' ? 'true' : '',
    [MONETIZATION_KEYS.affiliateRules]: rules.length ? JSON.stringify(rules) : '',
    [MONETIZATION_KEYS.disclosureEnabled]: formData.get('disclosureEnabled') === 'on' ? '' : 'false',
    [MONETIZATION_KEYS.disclosureText]: disclosureText === DEFAULT_DISCLOSURE ? '' : disclosureText,
    [MONETIZATION_KEYS.adMarkingEnabled]: formData.get('adMarkingEnabled') === 'on' ? 'true' : '',
    [MONETIZATION_KEYS.adMarkingText]: adMarkingText === DEFAULT_AD_MARKING ? '' : adMarkingText,
    [MONETIZATION_KEYS.donateUrl]: donateUrl,
  })
  clearMonetizationCache()
  // Денежные настройки — в аудит: кто и когда менял правила/тумблеры.
  const { recordAudit } = await import('@/shared/audit')
  await recordAudit('monetization.settings', { actorId: admin.userId })
  revalidatePath('/admin')
}

// ── Реиндексация эмбеддингов (RAG) ───────────────────────────────────
export async function startReindex(spreadMinutes: number): Promise<{ ok: true } | { error: string }> {
  if (!(await getAdmin())) return { error: 'Доступ запрещён.' }
  const { startIndexRun } = await import('@/shared/ai/index-run')
  const minutes = Math.min(Math.max(Number(spreadMinutes) || 0, 0), 120)
  return startIndexRun(minutes * 60_000)
}

export async function getReindexStatus() {
  if (!(await getAdmin())) return null
  const { getIndexRun } = await import('@/shared/ai/index-run')
  return getIndexRun()
}

export async function purgeEmbeddings(): Promise<{ ok: true; removed: number } | { error: string }> {
  if (!(await getAdmin())) return { error: 'Доступ запрещён.' }
  try {
    const { searchIndex } = await import('@/features/search/adapter')
    const { removed } = await searchIndex.purgeStale()
    return { ok: true, removed }
  } catch (e) {
    return { error: `Не удалось: ${e instanceof Error ? e.message : 'ошибка'}` }
  }
}

/** Пространство эмбеддингов для панели: чем построен индекс, цель, покрытие. */
export async function getEmbedSpaceInfo(): Promise<{
  index: { provider: string; docModel: string; dim: number; at?: number }
  target: { provider: string; docModel: string; dim: number }
  inSync: boolean
  rows: number
  vectorized: number
} | null> {
  if (!(await getAdmin())) return null
  const [{ ensureFreshSpace }, { db, embeddings }, { sql }] = await Promise.all([
    import('@/shared/ai/embed-space'),
    import('@/shared/db'),
    import('drizzle-orm'),
  ])
  const { index, target, inSync } = await ensureFreshSpace()
  const [stats] = await db
    .select({
      rows: sql<number>`count(*)::int`,
      vectorized: sql<number>`(count(*) filter (where ${embeddings.embedding} is not null))::int`,
    })
    .from(embeddings)
  return {
    index: { provider: index.provider, docModel: index.docModel, dim: index.dim, at: index.at },
    target: { provider: target.provider, docModel: target.docModel, dim: target.dim },
    inSync,
    rows: stats?.rows ?? 0,
    vectorized: stats?.vectorized ?? 0,
  }
}

/** Цель эмбеддингов (провайдер); вступает в силу полным реиндексом. */
export async function setEmbedTarget(provider: string): Promise<{ ok: true } | { error: string }> {
  if (!(await getAdmin())) return { error: 'Доступ запрещён.' }
  if (provider !== 'openrouter' && provider !== 'yandex') return { error: 'Неизвестный провайдер.' }
  const [{ EMBED_TARGET_SETTING, clearEmbedSpaceCache }, { saveSettings }] = await Promise.all([
    import('@/shared/ai/embed-space'),
    import('@/shared/settings/kv'),
  ])
  await saveSettings({ [EMBED_TARGET_SETTING]: provider })
  clearEmbedSpaceCache()
  return { ok: true }
}

// ── Баланс OpenRouter (свежий, для виджета) ──────────────────────────
export async function fetchOpenRouterCredits(): Promise<
  { ok: true; total: number; used: number; remaining: number } | { error: string }
> {
  if (!(await getAdmin())) return { error: 'Доступ запрещён.' }
  const { getOpenRouterCredits, clearCreditsCache } = await import('@/shared/ai/credits')
  clearCreditsCache()
  const c = await getOpenRouterCredits({ fresh: true })
  if (!c) return { error: 'Не удалось получить баланс (нет ключа или API недоступен).' }
  return { ok: true, total: c.total, used: c.used, remaining: c.remaining }
}

/** Тумблер «сайт на ремонте» (см. shared/settings/maintenance + middleware).
 *  Возвращает НОВОЕ состояние. Аудит — кто и когда дёрнул рубильник. */
export async function toggleMaintenance(on: boolean): Promise<boolean> {
  const admin = await requireAdmin()
  await setMaintenance(on)
  const { recordAudit } = await import('@/shared/audit')
  await recordAudit(on ? 'maintenance.on' : 'maintenance.off', { actorId: admin.userId })
  revalidatePath('/admin')
  return maintenanceFlag()
}

// ── Менеджер ростера совета (таблица council_experts, см. shared/ai/roster.ts) ────────
/**
 * Сохранить эксперта. id не редактируется и приходит скрытым полем: он же имя встроенной
 * аватарки и значение who в истории бесед — переименование осиротило бы и картинку, и историю.
 * Поэтому же нет удаления: выключение флагом enabled.
 */
export async function saveExpert(formData: FormData): Promise<void> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return

  // Домены = те же теги по смыслу, поэтому и ввод тот же (TagInput): он пишет slug'и через ПРОБЕЛ.
  // «Любая тема» — тумблер, а не домен «*»: normalize у TagInput звёздочку бы вырезал.
  const domains =
    formData.get('anyTopic') === 'on'
      ? ['*']
      : String(formData.get('domains') ?? '')
          .split(/[\s,]+/)
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s && s !== '*')
  const modelRaw = String(formData.get('model') ?? '').trim()

  await db
    .update(councilExperts)
    .set({
      nameRu: String(formData.get('nameRu') ?? '').trim().slice(0, 40),
      nameEn: String(formData.get('nameEn') ?? '').trim().slice(0, 40),
      persona: String(formData.get('persona') ?? '').trim().slice(0, 2000),
      guildRu: String(formData.get('guildRu') ?? '').trim().slice(0, 60),
      guildEn: String(formData.get('guildEn') ?? '').trim().slice(0, 60),
      code: String(formData.get('code') ?? '').trim().slice(0, 1200),
      lens: String(formData.get('lens') ?? '').trim().slice(0, 200),
      domains,
      model: modelRaw === '__none__' ? '' : modelRaw,
      online: formData.get('online') === 'on',
      enabled: formData.get('enabled') === 'on',
      updatedAt: new Date(),
    })
    .where(eq(councilExperts.id, id))
  revalidatePath('/admin')
}

/**
 * Загрузить свою картинку эксперту. Файл валидирует uploadImageFile — по СОДЕРЖИМОМУ
 * (magic bytes), а не по mime от клиента; S3 не настроен → упадёт на диск (public/uploads).
 * Прошлую загруженную удаляем: иначе S3 копит мусор, на который никто не ссылается.
 */
export async function uploadExpertAvatar(formData: FormData): Promise<{ ok: true } | { error: string }> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '').trim()
  const file = formData.get('file')
  if (!id || !(file instanceof File) || !file.size) return { error: 'no_file' }

  const [cur] = await db.select().from(councilExperts).where(eq(councilExperts.id, id)).limit(1)
  if (!cur) return { error: 'not_found' }

  try {
    const ref = await uploadImageFile('council', file)
    if (cur.avatarUploaded && cur.avatar) await removeImageFile(cur.avatar).catch(() => {})
    await db
      .update(councilExperts)
      .set({ avatar: ref, avatarUploaded: true, updatedAt: new Date() })
      .where(eq(councilExperts.id, id))
    revalidatePath('/admin')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'upload_failed' }
  }
}

/** Вернуть эксперту встроенную картинку (и убрать загруженную из хранилища). */
export async function resetExpertAvatar(id: string): Promise<void> {
  await requireAdmin()
  const [cur] = await db.select().from(councilExperts).where(eq(councilExperts.id, id)).limit(1)
  if (!cur) return
  if (cur.avatarUploaded && cur.avatar) await removeImageFile(cur.avatar).catch(() => {})
  await db
    .update(councilExperts)
    .set({ avatar: id, avatarUploaded: false, updatedAt: new Date() })
    .where(eq(councilExperts.id, id))
  revalidatePath('/admin')
}

/** Выбрать встроенного персонажа. Загруженную картинку при этом убираем из хранилища — она больше не нужна. */
export async function setExpertAvatar(id: string, builtin: string): Promise<void> {
  await requireAdmin()
  const [cur] = await db.select().from(councilExperts).where(eq(councilExperts.id, id)).limit(1)
  if (!cur) return
  if (cur.avatarUploaded && cur.avatar) await removeImageFile(cur.avatar).catch(() => {})
  await db
    .update(councilExperts)
    .set({ avatar: builtin, avatarUploaded: false, updatedAt: new Date() })
    .where(eq(councilExperts.id, id))
  revalidatePath('/admin')
}
