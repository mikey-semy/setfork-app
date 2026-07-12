import 'server-only'
import { inArray } from 'drizzle-orm'
import { appSettings, db } from '@/shared/db'
import { parseAffiliateRules, type AffiliateRule } from '@/core'

// Настройки монетизации и трафика — всё управляется из админки (appSettings),
// без env-флагов. Храним только отклонения от дефолтов ('' в kv = удалить ключ):
// тумблеры-по-умолчанию-ВКЛ пишутся как 'false', по-умолчанию-ВЫКЛ — как 'true'.

export const MONETIZATION_KEYS = {
  viewTracking: 'monetization.view_tracking', // маячок просмотров списка
  linkTracking: 'monetization.link_tracking', // refs через /api/go (журнал кликов)
  affiliateEnabled: 'monetization.affiliate_enabled', // подстановка партнёрских тегов
  affiliateRules: 'monetization.affiliate_rules', // JSON: AffiliateRule[]
  disclosureEnabled: 'monetization.disclosure_enabled', // FTC-плашка на списках с партнёрскими ссылками
  disclosureText: 'monetization.disclosure_text', // кастомный текст плашки ('' = дефолт)
  donateUrl: 'monetization.donate_url', // внешняя donate-ссылка ('' = не показывать)
} as const

// FTC: плашка обязана быть заметной и до ссылок — дефолт менять осознанно.
export const DEFAULT_DISCLOSURE =
  'This list contains affiliate links — SetFork may earn a commission if you make a purchase, at no extra cost to you.'

export interface MonetizationSettings {
  viewTracking: boolean
  linkTracking: boolean
  affiliateEnabled: boolean
  affiliateRules: AffiliateRule[]
  disclosureEnabled: boolean
  disclosureText: string
  donateUrl: string
}

const DEFAULTS: Omit<MonetizationSettings, 'affiliateRules'> = {
  viewTracking: true,
  linkTracking: true,
  affiliateEnabled: false,
  disclosureEnabled: true,
  disclosureText: DEFAULT_DISCLOSURE,
  donateUrl: '',
}

// Читается на каждый рендер списка и каждый клик /api/go — кэш с TTL (как у
// maintenance): мульти-инстанс подхватит смену за ≤TTL, свой — мгновенно (clear).
const TTL_MS = 5_000
let cache: { value: MonetizationSettings; ts: number } | null = null
export function clearMonetizationCache(): void {
  cache = null
}

export async function getMonetizationSettings(): Promise<MonetizationSettings> {
  const now = Date.now()
  if (cache && now - cache.ts < TTL_MS) return cache.value
  let value: MonetizationSettings
  try {
    const rows = await db.select().from(appSettings).where(inArray(appSettings.key, Object.values(MONETIZATION_KEYS)))
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    value = {
      viewTracking: m[MONETIZATION_KEYS.viewTracking] !== 'false',
      linkTracking: m[MONETIZATION_KEYS.linkTracking] !== 'false',
      affiliateEnabled: m[MONETIZATION_KEYS.affiliateEnabled] === 'true',
      affiliateRules: parseAffiliateRules(m[MONETIZATION_KEYS.affiliateRules] ?? '[]'),
      disclosureEnabled: m[MONETIZATION_KEYS.disclosureEnabled] !== 'false',
      disclosureText: (m[MONETIZATION_KEYS.disclosureText] ?? '').trim() || DEFAULTS.disclosureText,
      donateUrl: sanitizeDonateUrl(m[MONETIZATION_KEYS.donateUrl] ?? ''),
    }
  } catch {
    // БД флапнула — трекинг/партнёрка не должны ронять страницу: дефолты или прошлое значение.
    value = cache?.value ?? { ...DEFAULTS, affiliateRules: [] }
  }
  cache = { value, ts: now }
  return value
}

/** Donate-ссылка выводится сырым <a href> в футере — только https. */
export function sanitizeDonateUrl(raw: string): string {
  const u = raw.trim()
  return /^https:\/\/\S+$/i.test(u) ? u : ''
}
