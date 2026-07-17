import 'server-only'
import { asc, eq } from 'drizzle-orm'
import { councilExperts, db } from '@/shared/db'

/**
 * Ростер совета: кто такие эксперты и как они себя ведут. Живёт в БД (council_experts), чтобы
 * владелец правил его в админке, а не правкой кода и деплоем.
 *
 * SEED — исходный состав. Он не «дефолт на всякий случай», а источник первого наполнения: пока
 * таблица пуста, совет работает ровно как раньше, и включение менеджера ничего не ломает.
 *
 * id смысловой ('chef') и служит сразу тремя вещами: ключ строки, имя встроенной аватарки
 * (public/gnomes/<id>.webp) и значение who в беседе. Поэтому переименование id = потеря аватарки и
 * связи с историей; в UI меняют name, а не id.
 */

export interface Expert {
  id: string
  nameEn: string
  nameRu: string
  persona: string
  domains: string[]
  /** Принудительная модель; пусто → из пула совета по кругу. */
  model: string
  /** Картинка: id встроенной или ключ S3. Пусто → берём id. */
  avatar: string
  avatarUploaded: boolean
  online: boolean
}

/** Исходный состав — им наполняем таблицу при первом обращении. */
export const SEED: Expert[] = [
  { id: 'devops', nameEn: 'Devops', nameRu: 'Девопсер', domains: ['deploy', 'devops', 'ci', 'servers', 'infra', 'docker', 'kubernetes'], persona: 'a pragmatic DevOps expert: reliability, rollbacks, health-checks, real-world production gotchas', model: '', avatar: '', avatarUploaded: false, online: false },
  { id: 'coder', nameEn: 'Coder', nameRu: 'Кодер', domains: ['programming', 'software', 'coding', 'api', 'library', 'framework'], persona: 'a meticulous software engineer: correctness, edge-cases, precise runnable steps', model: '', avatar: '', avatarUploaded: false, online: false },
  { id: 'chef', nameEn: 'Chef', nameRu: 'Повар', domains: ['cooking', 'food', 'recipe', 'kitchen', 'baking'], persona: 'a fast, practical chef: ingredients, order, timings', model: '', avatar: '', avatarUploaded: false, online: false },
  { id: 'traveler', nameEn: 'Wanderer', nameRu: 'Странник', domains: ['travel', 'trip', 'city', 'tourism', 'itinerary'], persona: 'a curious traveler: routes, budget, not-to-miss spots', model: '', avatar: '', avatarUploaded: false, online: false },
  { id: 'coach', nameEn: 'Coach', nameRu: 'Тренер', domains: ['fitness', 'health', 'workout', 'sport', 'nutrition'], persona: 'a disciplined coach: progression, safety, consistency', model: '', avatar: '', avatarUploaded: false, online: false },
  { id: 'scholar', nameEn: 'Scholar', nameRu: 'Книжник', domains: ['study', 'learning', 'research', 'course', 'exam'], persona: 'a thoughtful scholar: structure of knowledge, sources, comprehension checks', model: '', avatar: '', avatarUploaded: false, online: false },
  { id: 'hoarder', nameEn: 'Hoarder', nameRu: 'Барахольщик', domains: ['*'], persona: 'a resource investigator: pulls external resources, links and tools', model: '', avatar: '', avatarUploaded: false, online: true },
  { id: 'generalist', nameEn: 'Generalist', nameRu: 'Универсал', domains: ['*'], persona: 'a well-rounded generalist: a solid list on any topic', model: '', avatar: '', avatarUploaded: false, online: false },
]

const row2expert = (r: typeof councilExperts.$inferSelect): Expert => ({
  id: r.id,
  nameEn: r.nameEn,
  nameRu: r.nameRu,
  persona: r.persona,
  domains: r.domains,
  model: r.model,
  avatar: r.avatar || r.id,
  avatarUploaded: r.avatarUploaded,
  online: r.online,
})

/** Наполнить пустую таблицу исходным составом. Идемпотентно: занятые id не трогаем. */
export async function seedRoster(): Promise<void> {
  await db
    .insert(councilExperts)
    .values(SEED.map((e, i) => ({ ...e, avatar: e.id, sort: i })))
    .onConflictDoNothing()
}

/**
 * Действующий ростер (только включённые, в заданном порядке). Пустая таблица → сеем и читаем снова.
 * Любая ошибка БД → SEED: совет обязан работать, даже если менеджер сломан.
 */
export async function getRoster(): Promise<Expert[]> {
  try {
    const read = () =>
      db.select().from(councilExperts).where(eq(councilExperts.enabled, true)).orderBy(asc(councilExperts.sort))
    let rows = await read()
    if (rows.length === 0) {
      await seedRoster()
      rows = await read()
    }
    return rows.length ? rows.map(row2expert) : SEED
  } catch (e) {
    console.warn('[roster] fallback to SEED', e instanceof Error ? e.message : e)
    return SEED
  }
}

/** Весь ростер для админки — включая выключенных. */
export async function getRosterAll(): Promise<(Expert & { enabled: boolean; sort: number })[]> {
  await seedRoster()
  const rows = await db.select().from(councilExperts).orderBy(asc(councilExperts.sort))
  return rows.map((r) => ({ ...row2expert(r), enabled: r.enabled, sort: r.sort }))
}
