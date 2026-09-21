import 'server-only'
import { and, eq } from 'drizzle-orm'
import { canViewList } from '@/core'
// eslint-disable-next-line boundaries/dependencies -- соредакторство живёт в collab (тот же кросс-фич-паттерн, что у ленты уведомлений)
import { collaborators, db, templates } from '@/shared/db'

/**
 * ВИДИТ ЛИ ПОЛУЧАТЕЛЬ СПИСОК, О КОТОРОМ ЕГО СОБИРАЮТСЯ ИЗВЕСТИТЬ.
 *
 * ⚠️ Лента уведомлений этот вопрос задаёт давно (`keepVisible`), и там же записано,
 * почему: строка уведомления живёт вечно, а видимость списка меняется — наблюдатель
 * остаётся после закрытия списка, и его лента иначе показывала бы ТЕКУЩЕЕ приватное
 * название. Чинилось как P1.
 *
 * А почта и пуш тот же вопрос не задавали. Они собирают текст в момент ОТПРАВКИ, читая
 * `templates.title` по id без всякого гейта, — и приватное название уезжало человеку
 * прямо в ТЕМЕ ПИСЬМА, то есть туда, откуда его уже не убрать. Тот же корень, что весь
 * день: правило есть и работает в одном месте, а в соседнем про него забыли.
 *
 * Гейт сознательно про ДОСТАВКУ, а не про запись строки: строка остаётся, лента
 * пересчитывает видимость на чтении, и человек, получивший доступ позже, увидит
 * пропущенное. Письмо же вернуть нельзя.
 */
export async function recipientSeesList(templateId: string, userId: string): Promise<boolean> {
  const [tpl] = await db
    .select({
      ownerId: templates.ownerId,
      visibility: templates.visibility,
      status: templates.status,
      moderation: templates.moderation,
    })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
  // Списка нет (удалён) — доставлять нечего: название взять неоткуда, а ссылка ведёт в никуда.
  if (!tpl) return false

  const isOwner = tpl.ownerId === userId
  if (canViewList(tpl, { isOwner })) return true
  // Соредактора спрашиваем лениво: за публичный список лишним запросом не платим.
  const [collab] = await db
    .select({ id: collaborators.id })
    .from(collaborators)
    .where(and(eq(collaborators.templateId, templateId), eq(collaborators.userId, userId)))
    .limit(1)
  return canViewList(tpl, { isOwner, isCollaborator: !!collab })
}
