import 'server-only'
import { AI_PROVIDERS, getProviderConfigFor, getAiProviderConfig, type AiProviderConfig, type AiProviderId } from '@/shared/settings/ai'
import { getSettings } from '@/shared/settings/kv'
import { envNumber } from '@/shared/env'
import { fetchModelsFor } from './models'

/**
 * ЗАПАСНОЙ ПРОВАЙДЕР — чтобы недоступность одного не останавливала генерацию целиком.
 *
 * Инцидент 2026-08-01: контейнер прода поднялся без egress-моста, `openrouter.ai` перестал
 * отвечать — и ИИ встал полностью, хотя ключ Яндекса лежал в базе рядом и работал. Ровно это
 * у LiteLLM решает Router (несколько deployments под одним именем), у нас же переключение было
 * только руками и только когда владелец заметит.
 *
 * ПОЧЕМУ ЯВНОЙ НАСТРОЙКОЙ, а не «переключаемся на любой живой»: провайдеры не равнозначны
 * юридически. Молча уронить генерацию с RU-провайдера на зарубежный значит отправить
 * пользовательский текст за границу без ведома владельца (152-ФЗ, разворот на РФ — ADR-0008).
 * Поэтому запасной задаётся руками, по умолчанию его нет, и подмена пишется в лог.
 */

export const FALLBACK_PROVIDER_SETTING = 'ai.fallback_provider'

/** Решение живёт короткое время: и клиент, и выбор модели в одном запросе обязаны
 *  получить ОДНОГО провайдера, иначе модель приедет из чужого неймспейса. */
const DECISION_TTL_MS = envNumber('SETFORK_PROVIDER_FAILOVER_TTL_S', 60) * 1000
let decision: { at: number; cfg: AiProviderConfig | null; failedOver: boolean } | null = null

export function clearProviderDecision(): void {
  decision = null
}

/** Настроенный запасной провайдер ('' = выключено). */
export async function getFallbackProviderId(): Promise<AiProviderId | ''> {
  const raw = (await getSettings([FALLBACK_PROVIDER_SETTING]))[FALLBACK_PROVIDER_SETTING]?.trim() || process.env.AI_FALLBACK_PROVIDER || ''
  return (AI_PROVIDERS as readonly string[]).includes(raw) ? (raw as AiProviderId) : ''
}

/**
 * Доступен ли провайдер: каталог отвечает и не пуст. Проверка идёт через кеш каталога
 * (успех 10 мин, отказ 60 с), поэтому она дешёвая и не превращается в лишний запрос на
 * каждую генерацию.
 */
export async function providerReachable(provider: AiProviderId): Promise<boolean> {
  try {
    const r = await fetchModelsFor(provider)
    return !r.error && r.chat.length > 0
  } catch {
    return false
  }
}

export interface ProviderDecision {
  cfg: AiProviderConfig | null
  /** true = работаем на запасном, потому что основной не отвечает. */
  failedOver: boolean
}

/**
 * Провайдер ДЛЯ ГЕНЕРАЦИИ (в отличие от «настроенного», который показывает админка).
 * Активный отвечает — берём его. Не отвечает и задан запасной, который отвечает — берём
 * запасной. Иначе возвращаем активный как есть: пусть вызов упадёт со своей настоящей
 * ошибкой, а не с выдуманной подменой.
 */
export async function generationProviderDecision(): Promise<ProviderDecision> {
  if (decision && Date.now() - decision.at < DECISION_TTL_MS) return { cfg: decision.cfg, failedOver: decision.failedOver }
  const active = await getAiProviderConfig()
  let cfg = active
  let failedOver = false
  if (active) {
    const fallbackId = await getFallbackProviderId()
    if (fallbackId && fallbackId !== active.provider && !(await providerReachable(active.provider))) {
      const spare = await getProviderConfigFor(fallbackId)
      if (spare && (await providerReachable(fallbackId))) {
        console.warn(`[ai] провайдер ${active.provider} недоступен — генерация уходит на запасной ${fallbackId}`)
        cfg = spare
        failedOver = true
      }
    }
  }
  decision = { at: Date.now(), cfg, failedOver }
  return { cfg, failedOver }
}

/** Конфиг провайдера для генерации (см. generationProviderDecision). */
export async function generationProviderConfig(): Promise<AiProviderConfig | null> {
  return (await generationProviderDecision()).cfg
}
