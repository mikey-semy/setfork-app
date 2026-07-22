import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db, templates, transferInvites, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'

export interface IncomingTransfer {
  id: string
  title: LocaleText
  fromHandle: string
  ownerHandle: string // текущий владелец (для ссылки на список, если публичный)
  slug: string
}

/** Ожидающие входящие передачи для получателя (для баннера/секции «принять»). */
export async function getIncomingTransfers(userId: string): Promise<IncomingTransfer[]> {
  const fromU = alias(users, 'from_u')
  const ownerU = alias(users, 'owner_u')
  const rows = await db
    .select({
      id: transferInvites.id,
      title: templates.title,
      slug: templates.slug,
      fromHandle: fromU.handle,
      ownerHandle: ownerU.handle,
    })
    .from(transferInvites)
    .innerJoin(templates, eq(templates.id, transferInvites.templateId))
    .innerJoin(fromU, eq(fromU.id, transferInvites.fromUserId))
    .innerJoin(ownerU, eq(ownerU.id, templates.ownerId))
    .where(and(eq(transferInvites.toUserId, userId), eq(transferInvites.status, 'pending')))
    .orderBy(desc(transferInvites.createdAt))
  return rows as IncomingTransfer[]
}

/** Ожидающий инвайт по списку (для Danger Zone владельца — показать «ждёт @x»). */
export async function getPendingTransfer(templateId: string): Promise<{ id: string; toHandle: string } | null> {
  const toU = alias(users, 'to_u')
  const [row] = await db
    .select({ id: transferInvites.id, toHandle: toU.handle })
    .from(transferInvites)
    .innerJoin(toU, eq(toU.id, transferInvites.toUserId))
    .where(and(eq(transferInvites.templateId, templateId), eq(transferInvites.status, 'pending')))
    .limit(1)
  return row ?? null
}
