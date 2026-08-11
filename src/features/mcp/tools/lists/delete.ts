// Удаление списка через MCP. Причина измениться одна — условия, при которых
// необратимое действие вообще допускается: подтверждение, замок модерации,
// требование назвать список актуальным адресом.

import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
import { tr } from '@/shared/i18n'
import { isAdminHandle } from '@/shared/auth/admin-handle'
import { recordAudit } from '@/shared/audit'

/** Удалить свой список целиком. Пробный черновик, созданный агентом, раньше можно
 *  было убрать только руками в интерфейсе (жалоба владельца 04.08.2026: после пробы
 *  остался мусорный черновик, а API его не удаляет).
 *
 *  Удаление НЕОБРАТИМО (каскадом уходят версии, шаги, звёзды, предложения), поэтому
 *  оно требует явного confirm — тем же приёмом, что сухой прогон у bulk_create_lists.
 *  Снятый модерацией список владелец удалить не может: hard-delete стёр бы его
 *  contentFingerprint, то есть защиту от повторной заливки того же контента. */
export async function mcpDeleteList(userId: string, handle: string, slug: string, confirm: boolean) {
  // Адрес ТОЛЬКО актуальный — в отличие от чтений и правок, которые прежний адрес
  // принимают. Удаление необратимо, и выполнять его по ссылке, устаревшей неизвестно
  // когда, нельзя: агент должен назвать список тем именем, которое у него сейчас.
  const owner = await db.select({ id: users.id }).from(users).where(eq(users.handle, handle)).limit(1)
  if (!owner[0]) return { error: 'list not found' as const }
  const tpl = await db.query.templates.findFirst({ where: (t) => and(eq(t.ownerId, owner[0].id), eq(t.slug, slug)) })
  if (!tpl) return { error: 'list not found' as const }
  if (tpl.ownerId !== userId) return { error: 'forbidden: you are not the owner' as const }

  const me = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1)
  if ((tpl.moderation === 'flagged' || tpl.moderation === 'hidden') && !isAdminHandle(me[0]?.handle ?? null)) {
    return { error: 'forbidden: list is locked by moderation — appeal instead of deleting' as const }
  }
  if (!confirm) {
    return {
      ref: `${handle}/${slug}`,
      deleted: false,
      title: tr(tpl.title, 'en'),
      status: tpl.status,
      version: tpl.currentVersion,
      hint: 'nothing was deleted — call again with confirm:true to delete this list for good (versions, steps, stars and suggested edits go with it)',
    }
  }
  await db.delete(templates).where(eq(templates.id, tpl.id)) // каскад: версии/шаги/звёзды/предложения
  await recordAudit('list.delete', { actorId: userId, targetType: 'list', targetId: tpl.id, meta: { slug: tpl.slug, via: 'mcp' } })
  return { ref: `${handle}/${slug}`, deleted: true }
}
