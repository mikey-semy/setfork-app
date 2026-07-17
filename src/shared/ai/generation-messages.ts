import 'server-only'
import { asc, eq, gt, and } from 'drizzle-orm'
import { db, generationMessages, generations } from '@/shared/db'

/**
 * Беседа генерации: реплики в БД, append-only.
 *
 * Раньше лента жила в Redis/памяти (TTL 5 минут, стиралась в начале каждой попытки) — разговор
 * исчезал, и пользователь терял ход придумывания. Теперь он не теряется никогда: ушёл, вернулся
 * через неделю — история на месте.
 *
 * Redis тут больше не нужен: БД так же мульти-инстансна (воркер и веб видят одно), а строк на прогон
 * десяток. shared/redis остаётся — на нём rate-limit-store.
 */

/**
 * Кто говорит. 'user' — реплика пользователя (запрос/дополнение); 'again' — нажал «ещё вариант»:
 * намерение без текста, подпись рисует UI (и потому не протухает в БД при смене языка);
 * 'result' — карточка варианта; 'error' — сорвалось.
 */
export type GenMessageKind =
  | 'user'
  | 'again'
  | 'plan'
  | 'summon'
  | 'seek'
  | 'draft'
  | 'innovate'
  | 'critique'
  | 'synth'
  | 'result'
  | 'error'

export interface GenMessage {
  id: string
  attempt: number
  kind: GenMessageKind
  who: string | null
  name: string | null
  text: string
  createdAt: Date
}

export interface NewGenMessage {
  attempt: number
  kind: GenMessageKind
  who?: string
  name?: string
  text: string
}

/** Добавить реплику. Ошибка не роняет генерацию: беседа — украшение, список важнее. */
export async function pushMessage(generationId: string, m: NewGenMessage): Promise<void> {
  if (!generationId) return
  try {
    await db.insert(generationMessages).values({
      generationId,
      attempt: m.attempt,
      kind: m.kind,
      who: m.who ?? null,
      name: m.name ?? null,
      text: m.text,
    })
  } catch (e) {
    console.warn('[generation] pushMessage failed', e instanceof Error ? e.message : e)
  }
}

/** Вся беседа по порядку. `after` — только свежее указанного момента (для лёгкого поллинга). */
export async function getMessages(generationId: string, after?: Date): Promise<GenMessage[]> {
  const where = after
    ? and(eq(generationMessages.generationId, generationId), gt(generationMessages.createdAt, after))
    : eq(generationMessages.generationId, generationId)
  const rows = await db
    .select({
      id: generationMessages.id,
      attempt: generationMessages.attempt,
      kind: generationMessages.kind,
      who: generationMessages.who,
      name: generationMessages.name,
      text: generationMessages.text,
      createdAt: generationMessages.createdAt,
    })
    .from(generationMessages)
    .where(where)
    .orderBy(asc(generationMessages.createdAt))
  return rows as GenMessage[]
}

/** Статус генерации пишет воркер — страница больше не гадает по таблице jobs. */
export async function setGenerationStatus(
  generationId: string,
  status: 'pending' | 'done' | 'failed' | 'clarify',
): Promise<void> {
  try {
    await db.update(generations).set({ status, updatedAt: new Date() }).where(eq(generations.id, generationId))
  } catch (e) {
    console.warn('[generation] setStatus failed', e instanceof Error ? e.message : e)
  }
}
