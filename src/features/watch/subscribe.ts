import 'server-only'
import { eq } from 'drizzle-orm'
import { db, templates } from '@/shared/db'
import { canViewList } from '@/core'
// eslint-disable-next-line boundaries/dependencies -- хранилище подписок в curation (как в watch/actions.ts)
import { curationStore } from '@/features/curation/store'
// eslint-disable-next-line boundaries/dependencies -- права коллаборатора из collab (тот же кросс-фич-паттерн, что в watch/actions.ts)
import { isCollaborator } from '@/features/collab/queries'

/**
 * ПОДПИСКА НА СПИСОК ПО ЯВНОМУ userId — для тех, у кого сессии нет.
 *
 * Жила в `watch/actions.ts` внутри `ensureWatch`, и userId там брался ИЗ СЕССИИ намеренно:
 * файл помечен `'use server'`, значит каждый его экспорт — сетевая точка входа, и
 * параметр userId дал бы «подписать любого на что угодно». Довод верен ровно для того
 * файла: здесь `'use server'` нет, снаружи этот модуль не вызывается, и userId приходит
 * не из запроса, а от того, кто уже установил личность (сессия сайта или токен MCP).
 *
 * Понадобилось это, когда задачи научились заводиться через MCP: автор задачи начинает
 * следить за списком, а `ensureWatch` в том пути падал бы на `requireSession` — cookie у
 * запроса MCP нет. Скопировать три строки было нельзя: вместе с ними скопировался бы
 * гейт видимости, и копия однажды разошлась бы с оригиналом (та же беда, что у двух
 * путей слияния).
 */

/** Список для гейта видимости + ник владельца для revalidate. */
export async function listForWatch(templateId: string) {
  const [t] = await db
    .select({
      id: templates.id,
      ownerId: templates.ownerId,
      slug: templates.slug,
      visibility: templates.visibility,
      status: templates.status,
      moderation: templates.moderation,
    })
    .from(templates)
    .where(eq(templates.id, templateId))
  return t
}

/**
 * Может ли зритель следить за списком. Нельзя следить за невидимым (приватный/
 * черновик/скрытый): watcher получал бы new_version-уведомления о правках владельца —
 * оракул активности приватного контента. Коллаборатор — «свой»: список ведут вместе.
 * Спрашиваем его только когда без него не проходит, чтобы не платить запросом на
 * каждый публичный список.
 */
export async function canWatch(
  t: NonNullable<Awaited<ReturnType<typeof listForWatch>>>,
  userId: string,
): Promise<boolean> {
  const isOwner = t.ownerId === userId
  if (canViewList(t, { isOwner })) return true
  return canViewList(t, { isOwner, isCollaborator: await isCollaborator(t.id, userId) })
}

/** Тихо подписать НАЗВАННОГО пользователя на список (идемпотентно). Гейт видимости —
 *  тот же, что у кнопки Watch. */
export async function subscribeToList(templateId: string, userId: string): Promise<void> {
  const t = await listForWatch(templateId)
  if (!t) return
  if (!(await canWatch(t, userId))) return
  await curationStore.ensureWatch(templateId, userId)
}
