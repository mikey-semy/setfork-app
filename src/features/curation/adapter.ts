import 'server-only'
import { and, eq, or, sql } from 'drizzle-orm'
import { canViewList, isPubliclyVisible, type CurationStore } from '@/core'
import { collaborators, db, stars, templates, watches } from '@/shared/db'

// Каноническая реализация порта CurationStore (звёзды/watch). Пост-MVP → Rust за тем же портом.
// Побочные эффекты уровня delivery (notify/revalidate) делают вызывающие server-actions.
export const curationStore: CurationStore = {
  async isStarred(listId, userId) {
    const [r] = await db
      .select({ id: stars.id })
      .from(stars)
      .where(and(eq(stars.templateId, listId), eq(stars.userId, userId)))
      .limit(1)
    return !!r
  },

  async toggleStar(listId, userId) {
    const [ex] = await db
      .select({ id: stars.id })
      .from(stars)
      .where(and(eq(stars.userId, userId), eq(stars.templateId, listId)))
      .limit(1)
    if (ex) {
      await db.delete(stars).where(and(eq(stars.userId, userId), eq(stars.templateId, listId)))
      await db.update(templates).set({ starsCount: sql`GREATEST(${templates.starsCount} - 1, 0)` }).where(eq(templates.id, listId))
      return false
    }
    await db.insert(stars).values({ userId, templateId: listId }).onConflictDoNothing()
    await db.update(templates).set({ starsCount: sql`${templates.starsCount} + 1` }).where(eq(templates.id, listId))
    return true
  },

  async isWatching(listId, userId) {
    const [r] = await db
      .select({ level: watches.level })
      .from(watches)
      .where(and(eq(watches.userId, userId), eq(watches.templateId, listId)))
      .limit(1)
    return r?.level === 'all' || r?.level === 'custom'
  },

  async watchState(listId, userId) {
    const [r] = await db
      .select({ level: watches.level, events: watches.events })
      .from(watches)
      .where(and(eq(watches.userId, userId), eq(watches.templateId, listId)))
      .limit(1)
    if (!r) return { level: 'participating', events: null }
    return { level: r.level, events: r.events ?? null }
  },

  async setWatch(listId, userId, level, events) {
    // 'participating' = глобальный дефолт = отсутствие строки.
    if (level === 'participating') {
      await db.delete(watches).where(and(eq(watches.userId, userId), eq(watches.templateId, listId)))
      return
    }
    const evs = level === 'custom' ? (events ?? {}) : null
    await db
      .insert(watches)
      .values({ userId, templateId: listId, level, events: evs })
      .onConflictDoUpdate({ target: [watches.userId, watches.templateId], set: { level, events: evs } })
  },

  async toggleWatch(listId, userId) {
    const [ex] = await db
      .select({ level: watches.level })
      .from(watches)
      .where(and(eq(watches.userId, userId), eq(watches.templateId, listId)))
      .limit(1)
    // Уже смотрит (all/custom) → снять до participating. Иначе (нет строки / ignore) → All Activity.
    if (ex && (ex.level === 'all' || ex.level === 'custom')) {
      await db.delete(watches).where(and(eq(watches.userId, userId), eq(watches.templateId, listId)))
      return false
    }
    await db
      .insert(watches)
      .values({ userId, templateId: listId, level: 'all', events: null })
      .onConflictDoUpdate({ target: [watches.userId, watches.templateId], set: { level: 'all', events: null } })
    return true
  },

  async ensureWatch(listId, userId) {
    try {
      // Авто-watch при участии: только если ещё нет выбора (не перебиваем ignore/custom).
      await db.insert(watches).values({ userId, templateId: listId, level: 'all' }).onConflictDoNothing()
    } catch {
      /* watch — не критичный путь */
    }
  },

  async watchCount(listId) {
    const [r] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(watches)
      .where(and(eq(watches.templateId, listId), sql`${watches.level} in ('all','custom')`))
    return r?.c ?? 0
  },

  async watcherIds(listId, event) {
    const rows = await db
      .select({ id: watches.userId })
      .from(watches)
      .where(
        and(
          eq(watches.templateId, listId),
          or(eq(watches.level, 'all'), and(eq(watches.level, 'custom'), sql`${watches.events} ->> ${event} = 'true'`)),
        ),
      )
    if (!rows.length) return []

    // Видимость проверяется на ЧТЕНИИ, а не удалением подписок: список закрыли —
    // рассылка прекращается, открыли обратно — возобновляется. Главный сценарий,
    // которому не нужен ни один чужой id: посторонний законно подписался на
    // публичный список, потом владелец сделал его приватным — подписка оставалась, и
    // в ленту продолжали капать заголовок, слаг и факт активности (линза 02, F8).
    // Фильтр здесь накрывает ВСЕ пути уведомлений разом (версии, задачи, правки).
    const [list] = await db
      .select({
        ownerId: templates.ownerId,
        visibility: templates.visibility,
        status: templates.status,
        moderation: templates.moderation,
      })
      .from(templates)
      .where(eq(templates.id, listId))
      .limit(1)
    if (!list) return []
    if (isPubliclyVisible(list)) return rows.map((r) => r.id)

    const collabIds = new Set(
      (
        await db
          .select({ userId: collaborators.userId })
          .from(collaborators)
          .where(eq(collaborators.templateId, listId))
      ).map((r) => r.userId),
    )
    // Один проход: .filter().map() гонял бы список дважды (react-doctor).
    return rows.reduce<string[]>((acc, r) => {
      if (canViewList(list, { isOwner: r.id === list.ownerId, isCollaborator: collabIds.has(r.id) })) acc.push(r.id)
      return acc
    }, [])
  },
}
