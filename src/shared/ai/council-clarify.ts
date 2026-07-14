import 'server-only'
import { getRedis } from '@/shared/redis'

/**
 * Диалог совета: при неоднозначном запросе совет вместо генерации отдаёт уточняющие вопросы.
 * Воркер кладёт вопросы, страница показывает форму, пользователь отвечает → ответы дозаписываются
 * в запрос джобы (память нити) и генерация перезапускается.
 *
 * Хранилище: Redis (если задан REDIS_URL) — мульти-инстанс; иначе in-memory (один инстанс, дефолт).
 * claimClarify — АТОМАРНЫЙ get+delete (Redis: GETDEL через Lua; память: single-threaded), чтобы
 * параллельный double-submit не задвоил джобу (см. answerClarify).
 */
const TTL_S = 15 * 60
const rkey = (id: string) => `council:clarify:${id}`
// Атомарный GETDEL (версия-независимо, вместо команды GETDEL из Redis 6.2+).
const GETDEL_LUA = "local v = redis.call('GET', KEYS[1]) redis.call('DEL', KEYS[1]) return v"

declare global {
  var __councilClarify: Map<string, { questions: string[]; exp: number }> | undefined
}
function mem(): Map<string, { questions: string[]; exp: number }> {
  return (globalThis.__councilClarify ??= new Map())
}
function parse(raw: string | null): string[] {
  if (!raw) return []
  try {
    const q = JSON.parse(raw)
    return Array.isArray(q) ? (q as string[]) : []
  } catch {
    return []
  }
}

export async function setClarify(id: string, questions: string[]): Promise<void> {
  if (!id || !questions.length) return
  const q = questions.slice(0, 4)
  const redis = getRedis()
  if (redis) {
    try {
      await redis.set(rkey(id), JSON.stringify(q), 'EX', TTL_S)
    } catch { /* fail-open */ }
    return
  }
  const m = mem()
  if (m.size > 500) {
    const now = Date.now()
    for (const [k, e] of m) if (e.exp <= now) m.delete(k)
  }
  m.set(id, { questions: q, exp: Date.now() + TTL_S * 1000 })
}

/** Неразрушающее чтение вопросов (для показа формы на странице). */
export async function getClarify(id: string): Promise<string[]> {
  const redis = getRedis()
  if (redis) {
    try {
      return parse(await redis.get(rkey(id)))
    } catch {
      return []
    }
  }
  const e = mem().get(id)
  if (!e || e.exp <= Date.now()) return []
  return e.questions
}

/** АТОМАРНО забрать вопросы И удалить (claim) — чтобы параллельный double-submit увидел пусто. */
export async function claimClarify(id: string): Promise<string[]> {
  const redis = getRedis()
  if (redis) {
    try {
      return parse((await redis.eval(GETDEL_LUA, 1, rkey(id))) as string | null)
    } catch {
      return []
    }
  }
  // Память: get+delete синхронны в одном потоке — атомарно.
  const e = mem().get(id)
  mem().delete(id)
  if (!e || e.exp <= Date.now()) return []
  return e.questions
}

export async function clearClarify(id: string): Promise<void> {
  const redis = getRedis()
  if (redis) {
    try {
      await redis.del(rkey(id))
    } catch { /* fail-open */ }
    return
  }
  mem().delete(id)
}
