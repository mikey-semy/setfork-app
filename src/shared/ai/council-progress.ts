import 'server-only'
import { getRedis } from '@/shared/redis'

/**
 * Живой «театр беседы» совета: воркер (где крутится generateListCouncil) публикует события хода,
 * страница генерации читает их на поллинге и рисует лентой поверх GnomeLoader.
 *
 * Хранилище: Redis (если задан REDIS_URL) — мульти-инстанс, воркер и веб видят одну ленту; иначе
 * in-memory (один инстанс, дефолт). Redis-ошибки не роняют генерацию (fail-open → лента пустеет,
 * страница откатывается на мем-лоадер).
 */
export interface CouncilEvent {
  ts: number
  kind: 'plan' | 'summon' | 'seek' | 'draft' | 'innovate' | 'critique' | 'synth'
  text: string
}

const TTL_S = 5 * 60
const MAX_EVENTS = 40
const rkey = (id: string) => `council:ev:${id}`

// in-memory фолбэк (один инстанс)
interface Entry {
  events: CouncilEvent[]
  exp: number
}
declare global {
  var __councilProgress: Map<string, Entry> | undefined
}
function mem(): Map<string, Entry> {
  return (globalThis.__councilProgress ??= new Map())
}

/** Опубликовать событие хода совета для generationId. */
export async function pushCouncilEvent(id: string, ev: Omit<CouncilEvent, 'ts'>): Promise<void> {
  if (!id) return
  const event: CouncilEvent = { ts: Date.now(), ...ev }
  const redis = getRedis()
  if (redis) {
    try {
      await redis.rpush(rkey(id), JSON.stringify(event))
      await redis.ltrim(rkey(id), -MAX_EVENTS, -1)
      await redis.expire(rkey(id), TTL_S)
    } catch { /* fail-open: театр не должен ронять генерацию */ }
    return
  }
  const m = mem()
  if (m.size > 500) {
    const now = Date.now()
    for (const [k, e] of m) if (e.exp <= now) m.delete(k)
  }
  const e = m.get(id) ?? { events: [], exp: 0 }
  e.events.push(event)
  if (e.events.length > MAX_EVENTS) e.events.shift()
  e.exp = Date.now() + TTL_S * 1000
  m.set(id, e)
}

/** Прочитать ленту событий совета (пусто, если нет/протухло). */
export async function getCouncilEvents(id: string): Promise<CouncilEvent[]> {
  const redis = getRedis()
  if (redis) {
    try {
      const raw = await redis.lrange(rkey(id), 0, -1)
      return raw
        .map((s) => {
          try {
            return JSON.parse(s) as CouncilEvent
          } catch {
            return null
          }
        })
        .filter((e): e is CouncilEvent => Boolean(e))
    } catch {
      return []
    }
  }
  const e = mem().get(id)
  if (!e || e.exp <= Date.now()) return []
  return e.events
}

/** Сбросить ленту (напр. при перегенерации того же generationId). */
export async function clearCouncilEvents(id: string): Promise<void> {
  const redis = getRedis()
  if (redis) {
    try {
      await redis.del(rkey(id))
    } catch { /* fail-open */ }
    return
  }
  mem().delete(id)
}
