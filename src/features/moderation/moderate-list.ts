import 'server-only'
import { and, asc, eq } from 'drizzle-orm'
import { db, steps, templates, templateVersions } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import { moderateContent, type ModerationVerdict } from '@/shared/ai/moderate'
import { getApiKey } from '@/shared/settings/ai'
import { enqueueJob } from '@/shared/jobs/queue'

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

/**
 * Гейт публикации (модель YouTube): публичный список сразу уходит в pending —
 * не виден никому, кроме владельца/админа, — и встаёт в очередь на авто-проверку.
 * Прошёл → active (виден всем), не прошёл → flagged (очередь админа).
 * Без настроенного ИИ-ключа гейт выключен: список остаётся active (dev/стенды).
 */
export async function gateListPublication(templateId: string): Promise<void> {
  try {
    if (!(await getApiKey())) return
    await db
      .update(templates)
      .set({ moderation: 'pending', moderationReason: null })
      .where(eq(templates.id, templateId))
    await enqueueJob('moderate', { templateId, gate: true })
  } catch {
    /* гейт не должен ронять публикацию; список остаётся active */
  }
}

/**
 * Пере-проверка УЖЕ видимого списка после правки (новая версия / merge / принятая
 * правка / git push). Список остаётся видимым, проверка идёт в фоне; нарушение → flagged.
 */
export async function recheckList(templateId: string): Promise<void> {
  try {
    if (!(await getApiKey())) return
    await enqueueJob('moderate', { templateId, gate: false })
  } catch {
    /* не критичный путь */
  }
}

export interface ModerateJobPayload {
  templateId: string
  gate: boolean // true — решаем судьбу pending-списка; false — фоновая пере-проверка видимого
}

/**
 * Джоб-логика авто-проверки. ИИ недоступен → бросаем (воркер ретраит с backoff);
 * на последней попытке гейт fail-open: список не должен вечно висеть невидимым
 * из-за сломанного ИИ — одобряем с пометкой, админ всегда может скрыть.
 */
export async function runModerateJob(payload: unknown, attempt: { attempts: number; maxAttempts: number }): Promise<void> {
  const p = payload as ModerateJobPayload
  const verdict = await moderateContent(await buildListText(p.templateId), { refId: p.templateId })
  if (!verdict) {
    if (p.gate && attempt.attempts >= attempt.maxAttempts) {
      await db
        .update(templates)
        .set({ moderation: 'active', moderationReason: 'auto-approved: AI unavailable' })
        .where(and(eq(templates.id, p.templateId), eq(templates.moderation, 'pending')))
      return
    }
    throw new Error('moderation AI unavailable')
  }
  if (verdict.flagged) {
    await db
      .update(templates)
      .set({ moderation: 'flagged', moderationReason: verdictReason(verdict) })
      .where(eq(templates.id, p.templateId))
  } else if (p.gate) {
    // только из pending — не перетираем ручное hide/flag админа, случившееся между постановкой и выполнением
    await db
      .update(templates)
      .set({ moderation: 'active', moderationReason: null })
      .where(and(eq(templates.id, p.templateId), eq(templates.moderation, 'pending')))
  }
}
