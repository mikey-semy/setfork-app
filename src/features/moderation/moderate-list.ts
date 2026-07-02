import 'server-only'
import { asc, eq } from 'drizzle-orm'
import { db, steps, templates, templateVersions } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import { moderateContent, type ModerationVerdict } from '@/shared/ai/moderate'

const flat = (x: LocaleText | null | undefined) => (x ? Object.values(x).filter(Boolean).join(' / ') : '')

/** Текст списка (заголовок + описание + шаги) для ИИ-проверки. */
export async function buildListText(templateId: string): Promise<string> {
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return ''
  const [ver] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(asc(templateVersions.version))
    .limit(1)
  const stepRows = ver ? await db.select().from(steps).where(eq(steps.versionId, ver.id)).orderBy(asc(steps.n)) : []
  return [
    flat(tpl.title),
    flat(tpl.desc),
    ...stepRows.map((s, i) => `${i + 1}. ${flat(s.title)} — ${flat(s.desc)} ${s.command}`),
  ]
    .filter(Boolean)
    .join('\n')
}

export function verdictReason(v: ModerationVerdict): string {
  return `AI [${v.category || '—'}]: ${v.reason}`
}

/** Авто-модерация ПУБЛИЧНОГО списка на публикации. Опасное → flagged (не публикуется). Best-effort. */
export async function autoModerateList(templateId: string): Promise<void> {
  try {
    const verdict = await moderateContent(await buildListText(templateId))
    if (verdict?.flagged) {
      await db
        .update(templates)
        .set({ moderation: 'flagged', moderationReason: verdictReason(verdict) })
        .where(eq(templates.id, templateId))
    }
  } catch {
    /* модерация — не критичный путь */
  }
}
