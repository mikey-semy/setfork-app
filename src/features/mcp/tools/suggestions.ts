import 'server-only'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, steps, suggestionReportedChecks, suggestions, templates, users, type ProposedItem } from '@/shared/db'
import { tr } from '@/shared/i18n'
import { applySuggestion, createSuggestion, currentRevision, mergeSuggestion, reviewSuggestion, revertSuggestion } from '@/features/library/suggestion-core'
import { REPORTED_STATUSES, reportedChecks, type ReportedStatus } from '@/features/library/suggestion-checks'
import { recordAgentAction } from '@/shared/agents/policy'
import { recordAudit } from '@/shared/audit'
import { toProposedItems } from '@/features/library/editor'
import { assertNoDestructiveSteps, DestructiveCommandError } from '@/core/domain/destructive-command'
import { isCollaborator } from '@/features/collab/queries'
import { mcpCanView, SITE_URL, toProposed, type McpItemInput } from './shared'

/**
 * Предложения правок через MCP: подать, отрецензировать, слить, откатить, применить,
 * посмотреть очередь и отчитаться о проверках.
 *
 * Отдельно от записи своих списков: здесь агент правит ЧУЖОЕ через тот же путь, что и
 * человек, и меняется этот сюжет вместе с правилами ревью, а не с правилами черновика.
 */

/**
 * Принять правку своего списка. Нужно затем, что правки компании копились без разбора:
 * заходить на страницу каждой — работа, а из ассистента это одна фраза.
 * Логика приёма НЕ дублируется — зовём то же ядро, что и кнопка на сайте.
 */
export async function mcpApplySuggestion(userId: string, suggestionId: string) {
  const res = await applySuggestion(suggestionId, userId)
  if (!res.ok) return { error: res.reason }
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  return { ref: `${u?.handle ?? ''}/${res.slug}`, version: res.version, note: 'Accepted — a new version was created.' }
}

/**
 * Отчёт внешней проверки о предложении — наш аналог status check.
 *
 * Кто вправе отчитываться: владелец списка и коллаборанты. НЕ автор предложения:
 * проверки видны рядом с гейтами слияния, и «сам себе поставил зелёное» превратило
 * бы их в украшение. Своё предложение автор всё равно не принимает сам.
 *
 * Ключ — пара (предложение, имя): повторный отчёт ОБНОВЛЯЕТ прежний. Длинный прогон
 * так и работает: сначала 'pending', потом настоящий итог.
 */
export async function mcpReportCheck(
  userId: string,
  input: { list: string; number: number; name: string; status: string; summary?: string; url?: string },
) {
  const name = input.name.trim().slice(0, 60)
  if (!name) return { error: 'name is required' }
  if (!(REPORTED_STATUSES as readonly string[]).includes(input.status)) {
    return { error: `status must be one of: ${REPORTED_STATUSES.join(', ')}` }
  }
  // Ссылка на лог — снаружи, поэтому только http(s): javascript:/data: в атрибуте
  // href на странице предложения были бы дырой, а не удобством.
  const url = (input.url ?? '').trim()
  if (url && !/^https?:\/\//i.test(url)) return { error: 'url must be http(s)' }

  const ref = input.list.includes('/') ? input.list.split('/') : [null, input.list]
  const [tpl] = await db
    .select({ id: templates.id, ownerId: templates.ownerId, slug: templates.slug })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(ref[0] ? and(eq(users.handle, ref[0]), eq(templates.slug, ref[1]!)) : eq(templates.slug, ref[1]!))
    .limit(1)
  if (!tpl) return { error: 'list not found' }
  if (tpl.ownerId !== userId && !(await isCollaborator(tpl.id, userId))) {
    return { error: 'only the list owner or a collaborator can report checks' }
  }

  const [sug] = await db
    .select({ id: suggestions.id, authorId: suggestions.authorId, status: suggestions.status, branchRef: suggestions.branchRef, items: suggestions.items, templateId: suggestions.templateId })
    .from(suggestions)
    .where(and(eq(suggestions.templateId, tpl.id), eq(suggestions.number, input.number)))
    .limit(1)
  if (!sug) return { error: 'suggestion not found' }
  if (sug.status !== 'open') return { error: 'suggestion is closed' }

  // К КАКОЙ ревизии относится отчёт. Без этого «ок» жил вечно: автор дописывал
  // предложение и сливал непроверенное.
  const revision = await currentRevision(sug)
  await db
    .insert(suggestionReportedChecks)
    .values({
      suggestionId: sug.id,
      name,
      status: input.status as ReportedStatus,
      revision,
      summary: (input.summary ?? '').trim().slice(0, 500) || null,
      url: url || null,
      reporterId: userId,
    })
    .onConflictDoUpdate({
      target: [suggestionReportedChecks.suggestionId, suggestionReportedChecks.name],
      set: {
        status: input.status as ReportedStatus,
        revision,
        summary: (input.summary ?? '').trim().slice(0, 500) || null,
        url: url || null,
        reporterId: userId,
        updatedAt: new Date(),
      },
    })

  const all = await reportedChecks(sug.id)
  return {
    reported: name,
    status: input.status,
    url: `${SITE_URL}/${ref[0] ?? ''}/${tpl.slug}/suggestions/${input.number}?tab=checks`,
    checks: all.map((c) => ({ name: c.title, status: c.status, summary: c.detail })),
  }
}

/**
 * Предложить правку к списку через MCP.
 *
 * Ворота те же, что у формы (их держит ядро): видимость списка, архив/заморозка,
 * настройка «кто может предлагать», кап на автора. Агент здесь такой же участник,
 * как человек, — и правка так же ждёт решения владельца, а не применяется сама.
 */
export async function mcpSuggestEdit(
  userId: string,
  input: { list: string; note: string; items: McpItemInput[] },
) {
  const tpl = await resolveListRef(input.list)
  if (!tpl) return { error: 'list not found' }
  const items = toProposed(input.items ?? [])
  if (items.length === 0) return { error: 'items must not be empty — a suggestion with no changes has nothing to accept' }
  const res = await createSuggestion(userId, tpl.id, { note: input.note ?? '', items })
  if (!res.ok) return { error: res.reason }
  return {
    id: res.id,
    number: res.number,
    url: `${SITE_URL}/${tpl.ownerHandle}/${tpl.slug}/suggestions/${res.number ?? res.id}`,
    note: 'Suggested — the list owner decides whether to accept it.',
  }
}

/** Оставить вердикт по предложению: одобрить, попросить правки или просто высказаться. */
export async function mcpReviewSuggestion(userId: string, input: { list: string; number: number; verdict: string; body?: string }) {
  const sug = await resolveSuggestionRef(input.list, input.number)
  if ('error' in sug) return sug
  const res = await reviewSuggestion(userId, sug.id, input.verdict, input.body ?? '')
  return res.ok ? { reviewed: input.number, verdict: res.verdict } : { error: res.reason }
}

/** Влить предложение (ветка или пункты — ядро решает само). */
export async function mcpMergeSuggestion(userId: string, input: { list: string; number: number }) {
  const sug = await resolveSuggestionRef(input.list, input.number)
  if ('error' in sug) return sug
  const res = await mergeSuggestion(sug.id, userId)
  if (!res.ok) return { error: res.reason }
  return {
    merged: input.number,
    kind: res.kind,
    version: res.version,
    url: `${SITE_URL}/${res.owner}/${res.slug}`,
  }
}

/** Откатить принятое предложение: создаётся НОВОЕ, отменяющее его. */
export async function mcpRevertSuggestion(userId: string, input: { list: string; number: number }) {
  const sug = await resolveSuggestionRef(input.list, input.number)
  if ('error' in sug) return sug
  const res = await revertSuggestion(userId, sug.id)
  if (!res.ok) {
    return { error: res.conflicts?.length ? `${res.reason}: ${res.conflicts.map((c) => c.title).join(', ')}` : res.reason }
  }
  return { revertOf: input.number, opened: res.number, note: 'A revert suggestion was opened — it still needs review and merging.' }
}

/** Список по ссылке «handle/slug» или просто «slug». */
async function resolveListRef(ref: string): Promise<{ id: string; slug: string; ownerHandle: string } | null> {
  const parts = ref.includes('/') ? ref.split('/') : [null, ref]
  const [row] = await db
    .select({ id: templates.id, slug: templates.slug, ownerHandle: users.handle })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(parts[0] ? and(eq(users.handle, parts[0]), eq(templates.slug, parts[1]!)) : eq(templates.slug, parts[1]!))
    .limit(1)
  return row ?? null
}

/** Предложение по паре «список + номер» — человеческий адрес, тот же, что в UI. */
async function resolveSuggestionRef(ref: string, number: number): Promise<{ id: string } | { error: string }> {
  const tpl = await resolveListRef(ref)
  if (!tpl) return { error: 'list not found' }
  const [row] = await db
    .select({ id: suggestions.id })
    .from(suggestions)
    .where(and(eq(suggestions.templateId, tpl.id), eq(suggestions.number, number)))
    .limit(1)
  return row ? { id: row.id } : { error: 'suggestion not found' }
}

/** Открытые правки на списках пользователя — что вообще ждёт его решения. */
export async function mcpPendingSuggestions(userId: string, limit = 20) {
  const rows = await db
    .select({
      id: suggestions.id,
      number: suggestions.number,
      note: suggestions.note,
      slug: templates.slug,
      items: sql<number>`jsonb_array_length(${suggestions.items})`,
      authorHandle: users.handle,
      createdAt: suggestions.createdAt,
    })
    .from(suggestions)
    .innerJoin(templates, eq(templates.id, suggestions.templateId))
    .innerJoin(users, eq(users.id, suggestions.authorId))
    .where(and(eq(templates.ownerId, userId), eq(suggestions.status, 'open')))
    .orderBy(suggestions.createdAt)
    .limit(Math.min(50, Math.max(1, limit)))
  return {
    pending: rows.length,
    suggestions: rows.map((r) => ({ id: r.id, list: r.slug, number: r.number, note: r.note, items: r.items, author: r.authorHandle, at: r.createdAt })),
  }
}

/**
 * РЕГИСТРАЦИЯ ИСТОЧНИКА — единственная дверь, через которую чужой материал попадает в корпус.
 *
 * Лицензию называет ЧЕЛОВЕК, а не угадывает алгоритм по домену: доступность страницы в
 * интернете не означает права копировать. Проверка fail-closed — невнятная лицензия равна
 * запрету, потому что материал возьмут один раз, а отвечать за него придётся всё время, пока
 * он лежит в библиотеке.
 *
 * Повторная регистрация того же адреса ОБНОВЛЯЕТ запись, а не плодит вторую с другой
 * лицензией: иначе вопрос «какая из них настоящая» решать нечем.
 */
