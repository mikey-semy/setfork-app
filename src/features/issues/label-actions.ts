'use server'

import { eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, issues, listLabels, templates, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { isCollaborator } from '@/features/collab/queries'
import { customKey, isHexColor, type CustomLabel } from '@/shared/lib/labels'

// Кастомные метки списка (CRUD) — владелец или коллаборатор, как assignees/labels.
async function canManage(templateId: string, userId: string): Promise<{ owner: string; slug: string } | null> {
  const [t] = await db
    .select({ ownerId: templates.ownerId, slug: templates.slug, handle: users.handle })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(eq(templates.id, templateId))
    .limit(1)
  if (!t) return null
  if (t.ownerId !== userId && !(await isCollaborator(templateId, userId))) return null
  return { owner: t.handle, slug: t.slug }
}

export type LabelResult = { ok: true; label: CustomLabel } | { error: 'forbidden' | 'empty' | 'color' | 'exists' }

export async function createLabel(templateId: string, name: string, color: string): Promise<LabelResult> {
  const session = await requireSession()
  const can = await canManage(templateId, session.userId)
  if (!can) return { error: 'forbidden' }
  const nm = name.trim().slice(0, 30)
  if (!nm) return { error: 'empty' }
  if (!isHexColor(color)) return { error: 'color' }
  let label: CustomLabel
  try {
    const [row] = await db
      .insert(listLabels)
      .values({ templateId, name: nm, color: color.toLowerCase() })
      .returning({ id: listLabels.id, name: listLabels.name, color: listLabels.color })
    label = row
  } catch {
    return { error: 'exists' } // unique(templateId, name)
  }
  revalidatePath(`/${can.owner}/${can.slug}/issues`)
  return { ok: true, label }
}

export async function deleteLabel(labelId: string): Promise<void> {
  const session = await requireSession()
  const [lbl] = await db.select({ templateId: listLabels.templateId }).from(listLabels).where(eq(listLabels.id, labelId)).limit(1)
  if (!lbl) return
  const can = await canManage(lbl.templateId, session.userId)
  if (!can) return
  await db.delete(listLabels).where(eq(listLabels.id, labelId))
  // Снимаем осиротевший ключ c:<id> со всех issue списка (jsonb-массив меток).
  const key = customKey(labelId)
  await db.execute(sql`
    update issues
    set labels = coalesce((select jsonb_agg(x) from jsonb_array_elements_text(labels) x where x <> ${key}), '[]'::jsonb)
    where template_id = ${lbl.templateId} and jsonb_exists(labels, ${key})`)
  revalidatePath(`/${can.owner}/${can.slug}/issues`)
}
