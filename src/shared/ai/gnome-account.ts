import 'server-only'
import { eq, sql } from 'drizzle-orm'
import { councilExperts, db, users } from '@/shared/db'
import type { Expert } from './roster'
import { HOME_REALM, mythicName } from './gnome-names'
import type { Lang } from '@/shared/i18n'

/**
 * Аккаунт специалиста совета — участник УРОВНЯ ПОЛЬЗОВАТЕЛЯ, а не запись в админке.
 *
 * Зачем: специалист должен вести СВОИ списки по темам, комментировать и предлагать
 * правки наравне с людьми. Пока он живёт только в council_experts, у него нет ни
 * профиля, ни авторства — принимать его правки некому и некем их подписать.
 *
 * Честность (ADR-0004): аккаунт помечен account_type='agent'. Это ДАННЫЕ, а не догадка
 * по handle и эмодзи в bio, как было у садовника, — UI и API обязаны показывать, что
 * перед человеком не человек.
 *
 * Входа у такого аккаунта нет: не заводим ни пароль, ни OAuth-идентификаторы, поэтому
 * ни одна форма логина его не подберёт.
 *
 * Имя и профессия РАЗДЕЛЕНЫ (решение владельца): имя — своё, профессия — буквальная и
 * лежит в профиле как должность. Исторически имя и было профессией ('Chef'), поэтому
 * пустая профессия читается из имени — см. professionOf.
 */

/** Отображаемое имя специалиста на языке зрителя. */
export const gnomeName = (e: Pick<Expert, 'nameEn' | 'nameRu'>, lang: Lang): string =>
  (lang === 'ru' ? e.nameRu : e.nameEn) || e.nameEn || e.nameRu

/**
 * Профессия на языке зрителя. Пусто → имя: у исходного состава имя И БЫЛО профессией
 * ('Chef'/'Повар'), и до переименования профиль обязан показывать хоть что-то верное.
 */
export function professionOf(e: Partial<Expert> & Pick<Expert, 'nameEn' | 'nameRu'>, lang: Lang): string {
  const own = lang === 'ru' ? e.professionRu : e.professionEn
  return (own || '').trim() || gnomeName(e, lang)
}

/** Свободный handle: смысловой id, при занятости — с числовым суффиксом. */
async function freeHandle(base: string): Promise<string> {
  const clean = base.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'expert'
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? clean : `${clean}-${i + 1}`
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.handle, candidate)).limit(1)
    if (!taken) return candidate
  }
  return `${clean}-${Date.now().toString(36)}`
}

/**
 * Завести (или переиспользовать) аккаунт специалиста и связать его с ростером.
 * Идемпотентно: связанный аккаунт возвращается как есть.
 */
export async function ensureGnomeUser(e: Expert): Promise<string | null> {
  try {
    const [row] = await db.select({ userId: councilExperts.userId }).from(councilExperts).where(eq(councilExperts.id, e.id))
    if (row?.userId) {
      const [alive] = await db.select({ id: users.id }).from(users).where(eq(users.id, row.userId)).limit(1)
      if (alive) return alive.id
    }
    const handle = await freeHandle(e.id)
    const [created] = await db
      .insert(users)
      .values({
        handle,
        name: gnomeName(e, 'en'),
        profession: professionOf(e, 'en'),
        // Нидавеллир — кузни, место работы мастеров (Свартальвхейм — весь мир).
        location: HOME_REALM,
        accountType: 'agent',
        // Встроенная картинка персонажа лежит в public/gnomes/<avatar>.webp — тот же
        // путь, что рисует беседа; так профиль и лента показывают одно лицо.
        avatarUrl: `/gnomes/${e.avatar || e.id}.webp`,
        bio: `${professionOf(e, 'en')} · SetFork council. I draft and improve lists in my domains; humans review and merge.`,
      })
      .returning({ id: users.id })
    if (!created) return null
    await db.update(councilExperts).set({ userId: created.id, updatedAt: new Date() }).where(eq(councilExperts.id, e.id))
    return created.id
  } catch (e2) {
    console.warn('[gnome-account] ensure failed', e2 instanceof Error ? e2.message : e2)
    return null // совет обязан работать даже без аккаунтов
  }
}

/** Аккаунты для всего действующего состава. Возвращает id → userId. */
export async function ensureGnomeUsers(roster: Expert[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const e of roster) {
    const id = await ensureGnomeUser(e)
    if (id) out[e.id] = id
  }
  return out
}

/**
 * Дать специалистам мифологические имена — ОДНОРАЗОВО и только тем, у кого имя всё ещё
 * равно профессии (исторически name_en='Chef' и был профессией). Собственное имя,
 * однажды заданное владельцем в админке, не перетираем: иначе правка молча откатывалась
 * бы при каждом прогоне — тем же граблям, что уже ловил бэкфилл гильдий.
 *
 * id НЕ трогаем: он же ключ аватарки и значение who в истории беседы.
 */
export async function assignMythicNames(): Promise<{ renamed: number; names: Record<string, string> }> {
  const rows = await db.select().from(councilExperts)
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  const pending = rows.filter((r) => same(r.nameEn, r.professionEn || r.nameEn))
  // Занятые имена: у кого имя уже своё — его не выдаём повторно.
  const taken = new Set(rows.filter((r) => !pending.includes(r)).map((r) => r.nameEn))
  const names: Record<string, string> = {}
  for (const r of pending) {
    const n = mythicName(r.id, r.professionEn || r.nameEn, taken)
    taken.add(n.name)
    await db
      .update(councilExperts)
      .set({ nameEn: n.name, nameRu: n.nameRu, updatedAt: new Date() })
      .where(eq(councilExperts.id, r.id))
    names[r.id] = `${n.name} / ${n.nameRu} (${n.source}: ${n.meaning})`
  }
  return { renamed: pending.length, names }
}

/** Сколько специалистов уже имеют аккаунт (для админки/дашборда). */
export async function gnomeAccountsCount(): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(councilExperts)
    .where(sql`${councilExperts.userId} is not null`)
  return r?.n ?? 0
}
