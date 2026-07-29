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
  await db
    .update(agendaItems)
    .set({ status, decidedBy: admin.userId, decidedAt: new Date(), updatedAt: new Date() })
    .where(eq(agendaItems.id, id))
  revalidatePath('/admin/development')
  redirect('/admin/development#agenda')
}
