'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { requireAdmin } from '@/shared/auth/admin'
import { agendaItems, db } from '@/shared/db'

/**
 * Решение гендиректора по пункту повестки. Петля предлагает — человек решает; без этого
 * шага повестка так и осталась бы отчётом.
 *
 * Отклонённый пункт петля БОЛЬШЕ НЕ ПРЕДЛАГАЕТ (см. runPartnersSweep): повторять вопрос
 * каждую неделю — не автономия, а навязчивость.
 */
export async function decideAgendaItem(formData: FormData): Promise<void> {
  const admin = await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const raw = String(formData.get('decision') ?? '')
  const status = raw === 'approved' || raw === 'dismissed' ? raw : null
  if (!id || !status) redirect('/admin/development')
  // ОДОБРИЛИ — значит у работы появляется ХОЗЯИН: один специалист, отвечающий за пункт от
  // начала до конца («имя, а не отдел»). Берём профильного мастера по теме пункта — того же,
  // кто и будет её вести; нет профильного (общефирменный пункт вроде спроса без ответа) —
  // остаётся пусто, и это честнее, чем назначить случайного.
  let ownerExpertId: string | null = null
  if (status === 'approved') {
    const [row] = await db.select({ domain: agendaItems.domain }).from(agendaItems).where(eq(agendaItems.id, id))
    if (row?.domain) {
      const [{ getRoster }, { tenderForTags }] = await Promise.all([
        import('@/shared/ai/roster'),
        import('@/shared/ai/gnome-account'),
      ])
      const tender = await tenderForTags([row.domain], await getRoster())
      ownerExpertId = tender?.expert.id ?? null
    }
  }
  await db
    .update(agendaItems)
    .set({ status, ownerExpertId, decidedBy: admin.userId, decidedAt: new Date(), updatedAt: new Date() })
    .where(eq(agendaItems.id, id))
  revalidatePath('/admin/development')
  redirect('/admin/development#agenda')
}
