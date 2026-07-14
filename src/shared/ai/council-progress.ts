import 'server-only'

/**
 * Живой «театр беседы» совета: воркер (где крутится generateListCouncil) публикует события хода
 * совета, страница генерации читает их на поллинге и рисует лентой поверх GnomeLoader.
 *
 * Хранилище — in-memory с TTL (воркер и веб-сервер в одном Node-процессе, см. instrumentation.ts →
 * startWorker). ВАЖНО: при мульти-инстансе (SKIP LOCKED в очереди) событие могло уйти на другой
 * инстанс — лента тогда пустая и страница штатно откатывается на мем-лоадер (не ошибка).
 * Хочешь железную мульти-инстанс ленту — вынести в Redis/БД (следующий инкремент).
 */
export interface CouncilEvent {
  ts: number
  kind: 'plan' | 'summon' | 'seek' | 'draft' | 'innovate' | 'critique' | 'synth'
  text: string
}

const TTL_MS = 5 * 60_000
const MAX_EVENTS = 40
interface Entry {
  events: CouncilEvent[]
  exp: number
}

declare global {
  var __councilProgress: Map<string, Entry> | undefined
}
function store(): Map<string, Entry> {
  return (globalThis.__councilProgress ??= new Map())
}
function sweep(m: Map<string, Entry>): void {
  if (m.size <= 500) return
  const now = Date.now()
  for (const [k, e] of m) if (e.exp <= now) m.delete(k)
}

/** Опубликовать событие хода совета для generationId. */
export function pushCouncilEvent(id: string, ev: Omit<CouncilEvent, 'ts'>): void {
  if (!id) return
  const m = store()
  sweep(m)
  const e = m.get(id) ?? { events: [], exp: 0 }
  e.events.push({ ts: Date.now(), ...ev })
  if (e.events.length > MAX_EVENTS) e.events.shift()
  e.exp = Date.now() + TTL_MS
  m.set(id, e)
}

/** Прочитать ленту событий совета (пусто, если нет/протухло). */
export function getCouncilEvents(id: string): CouncilEvent[] {
  const e = store().get(id)
  if (!e || e.exp <= Date.now()) return []
  return e.events
}

/** Сбросить ленту (напр. при перегенерации того же generationId). */
export function clearCouncilEvents(id: string): void {
  store().delete(id)
}
