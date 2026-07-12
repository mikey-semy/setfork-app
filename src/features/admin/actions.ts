'use server'

import { revalidatePath } from 'next/cache'
import { getAdmin, requireAdmin } from '@/shared/auth/admin'
import { saveSettings } from '@/shared/settings/kv'
import { maintenanceFlag, setMaintenance } from '@/shared/settings/maintenance'
import { API_KEY_SETTING, defaultChatModel, defaultEmbeddingModel, hasApiKey } from '@/shared/settings/ai'
import { clearMediaCache, MEDIA_KEYS } from '@/shared/settings/media'
import { clearSearchCache, SEARCH_KEYS, SEARCH_MODES, type SearchMode } from '@/shared/settings/search'
import { clearEmailCache, EMAIL_KEYS, emailEnabled } from '@/shared/settings/email'
import { clearMonetizationCache, DEFAULT_DISCLOSURE, MONETIZATION_KEYS, sanitizeDonateUrl } from '@/shared/settings/monetization'
import { parseAffiliateRules } from '@/core'
import { clearVapidCache, VAPID_KEYS } from '@/shared/push/vapid'
import { sendMail } from '@/shared/email/mailer'
import { db, users } from '@/shared/db'
import { eq } from 'drizzle-orm'

export async function setAiSettings(formData: FormData): Promise<void> {
  await requireAdmin()
  const enabled = formData.get('enabled') === 'on'
  const chatModel = String(formData.get('chatModel') ?? '').trim()
  const fallbackRaw = String(formData.get('fallbackModel') ?? '').trim()
  const fallbackModel = fallbackRaw === '__none__' ? '' : fallbackRaw
  const embeddingModel = String(formData.get('embeddingModel') ?? '').trim()
  const temperature = Math.min(2, Math.max(0, Number(formData.get('temperature')) || 0.3))
  const maxTokens = Math.min(4000, Math.max(64, Math.round(Number(formData.get('maxTokens')) || 1500)))
  const cheapModeThreshold = Math.max(0, Number(formData.get('cheapModeThreshold')) || 0)
  // Ключ пишем только если поле заполнено — пустое поле значит «не менять».
  const apiKey = String(formData.get('apiKey') ?? '').trim()

  const settings: Record<string, string> = {
    'ai.chat_model': chatModel || defaultChatModel(),
    'ai.fallback_model': fallbackModel,
    'ai.embedding_model': embeddingModel || defaultEmbeddingModel(),
    'ai.temperature': String(temperature),
    'ai.max_tokens': String(maxTokens),
    'ai.cheap_mode_threshold': String(cheapModeThreshold),
  }
  if (apiKey) settings[API_KEY_SETTING] = apiKey
  // Включать генерацию можно только при наличии ключа.
  const keyExists = apiKey.length > 0 || (await hasApiKey())
  settings['ai.enabled'] = enabled && keyExists ? 'true' : 'false'

  await saveSettings(settings)
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
