import 'server-only'
import { getSettings, saveSettings } from '@/shared/settings/kv'
import { COLUMN_DIM, type EmbedProvider } from './embed-space'

/**
 * ЧТО МОДЕЛЬ РЕАЛЬНО ОТДАЁТ — измеренный факт вместо списка «известных» моделей в коде.
 *
 * Провайдеры не публикуют мерность эмбеддингов в /models, и раньше совместимость решалась
 * табличкой на три модели, а потом регуляркой по имени вендора. И то и другое устаревает
 * молча: в каталоге OpenRouter 31 эмбеддинг-модель, а выбрать давали две, причём подпись
 * поля называла чужую мерность. Теперь правило одно: спросили провайдера — записали ответ.
 *
 * Факт добывается двумя путями и обоими одинаково:
 *  - попутно: любой обычный вызов эмбеддингов знает длину вектора (rememberCapability);
 *  - явно: короткая проба на одном слове (ensureCapability), доли цента.
 *
 * Хранилище — app_settings (JSON), потому что это настройка стенда, а не данные пользователя:
 * переживает перезапуск, едет вместе с базой, правится руками в крайнем случае.
 */

export interface EmbedCapability {
  provider: EmbedProvider
  model: string
  /** Длина вектора, которую модель отдала на запрос с dimensions = мерность колонки. */
  dim: number
  /** Приняла ли модель параметр dimensions (false = пришлось звать без него). */
  dimsAccepted: boolean
  /** Момент измерения, unix ms. */
  at: number
}

/** Как вектор ляжет в колонку. Вычисляется из измеренного, не задаётся руками. */
export type EmbedFit = 'exact' | 'truncated' | 'padded'

export const CAPABILITY_SETTING = 'embed.capabilities'

export const capKey = (provider: EmbedProvider, model: string) => `${provider}\u0000${model}`

export function fitOf(dim: number): EmbedFit {
  if (dim === COLUMN_DIM) return 'exact'
  return dim > COLUMN_DIM ? 'truncated' : 'padded'
}

type CapMap = Record<string, EmbedCapability>

// Кеш процесса: карта читается на каждой отрисовке каталога и на каждом вызове эмбеддингов,
// а меняется раз в жизни модели. TTL короткий — правка руками должна доезжать сама.
let cache: { at: number; map: CapMap } | null = null
const CACHE_TTL_MS = 60_000

export function clearCapabilityCache(): void {
  cache = null
}

export async function getCapabilities(): Promise<CapMap> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.map
  const raw = (await getSettings([CAPABILITY_SETTING]))[CAPABILITY_SETTING]
  let map: CapMap = {}
  try {
    if (raw) map = JSON.parse(raw) as CapMap
  } catch {
    map = {} // битый JSON = знаний нет, измерим заново
  }
  cache = { at: Date.now(), map }
  return map
}

export async function getCapability(provider: EmbedProvider, model: string): Promise<EmbedCapability | undefined> {
  return (await getCapabilities())[capKey(provider, model)]
}

/**
 * Запомнить измеренное. Пишем в БД ТОЛЬКО при изменении: попутный вызов случается на каждом
 * эмбеддинге, и запись на каждый из них была бы лишней нагрузкой ради одной и той же строки.
 */
export async function rememberCapability(
  provider: EmbedProvider,
  model: string,
  dim: number,
  dimsAccepted: boolean,
): Promise<void> {
  try {
    if (!model || !dim) return
    const map = await getCapabilities()
    const key = capKey(provider, model)
    const prev = map[key]
    if (prev && prev.dim === dim && prev.dimsAccepted === dimsAccepted) return
    const next: CapMap = { ...map, [key]: { provider, model, dim, dimsAccepted, at: Date.now() } }
    await saveSettings({ [CAPABILITY_SETTING]: JSON.stringify(next) })
    cache = { at: Date.now(), map: next }
  } catch (e) {
    // Знание о модели — удобство, а не условие работы: сбой записи не должен ронять индексацию.
    console.warn('[embed-capability] remember failed', e instanceof Error ? e.message : e)
  }
}

/**
 * Факт о модели: из памяти, а если его нет — измерить пробой (один короткий вызов).
 * Импорт пробы динамический: embeddings.ts зовёт rememberCapability отсюда, статическая
 * пара импортов дала бы цикл.
 */
export async function ensureCapability(provider: EmbedProvider, model: string): Promise<EmbedCapability | null> {
  if (!model) return null
  const known = await getCapability(provider, model)
  if (known) return known
  const { probeEmbedModel } = await import('./embeddings')
  const probe = await probeEmbedModel(provider, model)
  if ('error' in probe) return null
  await rememberCapability(provider, model, probe.dim, probe.dimsAccepted)
  return (await getCapability(provider, model)) ?? null
}
