'use server'

import { revalidatePath } from 'next/cache'
import { asc, eq } from 'drizzle-orm'
import { db, steps, templates, templateVersions } from '@/shared/db'
import { getAdmin } from '@/shared/auth/admin'
import type { LocaleText } from '@/shared/i18n'
import { moderateContent } from '@/shared/ai/moderate'

type Mod = 'active' | 'flagged' | 'hidden'

export async function setVerified(templateId: string, verified: boolean): Promise<{ ok: true } | { error: string }> {
  if (!(await getAdmin())) return { error: 'Доступ запрещён.' }
  await db.update(templates).set({ verified }).where(eq(templates.id, templateId))
  revalidatePath('/admin/moderation')
  revalidatePath('/explore')
  return { ok: true }
}

export async function setModeration(
  templateId: string,
  moderation: Mod,
  reason?: string,
): Promise<{ ok: true } | { error: string }> {
  if (!(await getAdmin())) return { error: 'Доступ запрещён.' }
  await db
    .update(templates)
    .set({ moderation, moderationReason: reason ?? null })
    .where(eq(templates.id, templateId))
  revalidatePath('/admin/moderation')
  revalidatePath('/explore')
  return { ok: true }
}

/** Собирает текст списка (заголовок + описание + шаги) для ИИ-проверки. */
async function listText(templateId: string): Promise<string> {
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return ''
  const [ver] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(asc(templateVersions.version))
    .limit(1)
  const stepRows = ver
    ? await db.select().from(steps).where(eq(steps.versionId, ver.id)).orderBy(asc(steps.n))
    : []
  const flat = (x: LocaleText | null | undefined) => (x ? Object.values(x).filter(Boolean).join(' / ') : '')
  return [
    flat(tpl.title as LocaleText),
    flat(tpl.desc as LocaleText),
    ...stepRows.map((s, i) => `${i + 1}. ${flat(s.title as LocaleText)} — ${flat(s.desc as LocaleText)} ${s.command}`),
  ]
    .filter(Boolean)
    .join('\n')
}

/** Проверить список ИИ; при опасности — flagged + причина. */
export async function aiModerate(templateId: string): Promise<{ flagged: boolean; reason: string } | { error: string }> {
  if (!(await getAdmin())) return { error: 'Доступ запрещён.' }
  const text = await listText(templateId)
  const result = await moderateContent(text)
  if (!result) return { error: 'ИИ недоступен (нет ключа/ошибка).' }
  await db
    .update(templates)
    .set({
      moderation: result.flagged ? 'flagged' : 'active',
      moderationReason: result.flagged ? `AI: ${result.reason}` : null,
    })
    .where(eq(templates.id, templateId))
  revalidatePath('/admin/moderation')
  return result
}
