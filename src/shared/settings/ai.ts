import 'server-only'
import { eq, inArray } from 'drizzle-orm'
import { appSettings, db } from '@/shared/db'

/** Ключ в app_settings, где хранится введённый в админке API-ключ OpenRouter. */
export const API_KEY_SETTING = 'ai.api_key'

export interface AiSettings {
  enabled: boolean
  chatModel: string
  fallbackModel: string
  embeddingModel: string
  temperature: number
  maxTokens: number
  /** Порог в USD: когда остаток на счёте OpenRouter ниже — переключаемся на fallbackModel. 0 = выкл. */
  cheapModeThreshold: number
}

const KEYS = [
  'ai.enabled',
  'ai.chat_model',
  'ai.fallback_model',
  'ai.embedding_model',
  'ai.temperature',
  'ai.max_tokens',
  'ai.cheap_mode_threshold',
] as const

export function defaultChatModel(): string {
  return process.env.OPENROUTER_CHAT_MODEL || 'openai/gpt-4o-mini'
}

export function defaultEmbeddingModel(): string {
  return process.env.EMBEDDING_MODEL || 'openai/text-embedding-3-small'
}

/** Синхронная проверка только env-ключа (для мест, где нет доступа к БД). */
export function hasOpenRouterKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY)
}

/** Действующий ключ: сначала введённый в админке (БД), иначе из .env. */
export async function getApiKey(): Promise<string> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, API_KEY_SETTING))
  return (rows[0]?.value?.trim() || process.env.OPENROUTER_API_KEY || '').trim()
}

export async function hasApiKey(): Promise<boolean> {
  return Boolean(await getApiKey())
}

/** Маскирует ключ для показа в UI: «sk-or-v1••••••••1a2b». Полный ключ на клиент не уходит. */
export function maskKey(k: string): string {
  if (!k) return ''
  if (k.length <= 12) return `${k.slice(0, 2)}${'•'.repeat(8)}`
  return `${k.slice(0, 8)}${'•'.repeat(10)}${k.slice(-4)}`
}

export async function getAiSettings(): Promise<AiSettings> {
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, [...KEYS]))
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  return {
    enabled: m['ai.enabled'] != null ? m['ai.enabled'] === 'true' : hasOpenRouterKey(),
    chatModel: m['ai.chat_model'] || defaultChatModel(),
    fallbackModel: m['ai.fallback_model'] || '',
    embeddingModel: m['ai.embedding_model'] || defaultEmbeddingModel(),
    temperature: num(m['ai.temperature'], 0.3),
    maxTokens: num(m['ai.max_tokens'], 1500),
    cheapModeThreshold: num(m['ai.cheap_mode_threshold'], 0),
  }
}

export async function isAiAvailable(): Promise<boolean> {
  if (!(await hasApiKey())) return false
  const s = await getAiSettings()
  return s.enabled
}
