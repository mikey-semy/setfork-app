import 'server-only'
import { eq, sql } from 'drizzle-orm'
import type { CollabStore, Issue, IssueComment, Suggestion, SuggestionComment } from '@/core'
import { db, issueComments, issues, suggestionComments, suggestions, templates, type ProposedItem } from '@/shared/db'

// Каноническая реализация порта CollabStore (issues/suggestions/comments).
// Delivery-эффекты (auth/notify/watch/revalidate/redirect) остаются в server-actions.

const mapIssue = (r: typeof issues.$inferSelect): Issue => ({
  id: r.id,
  listId: r.templateId,
  number: r.number,
  authorId: r.authorId,
  title: r.title,
  body: r.body,
  status: r.status,
  labels: r.labels,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  closedAt: r.closedAt,
})

const mapIssueComment = (r: typeof issueComments.$inferSelect): IssueComment => ({
  id: r.id,
  issueId: r.issueId,
  authorId: r.authorId,
  body: r.body,
  createdAt: r.createdAt,
})

// blockId и type/content переносим ЯВНО: без них предложение теряет идентичность
// блоков (ADR-0013) прямо при создании, и всё, что на ней стоит — привязка
// review-комментариев, отметки «просмотрено», применение предложенной правки,
// откат — молча перестаёт находить, к чему относится.
const domainStepToProposed = (s: Suggestion['steps'][number]): ProposedItem => ({
  blockId: s.blockId ?? undefined,
  type: s.type,
  content: s.content,
  title: s.title,
  desc: s.desc,
  command: s.command,
  hasImage: !!s.imageRef,
  imageKey: s.imageRef ?? undefined,
  level: s.level,
  why: s.why,
  section: s.section,
  subtasks: s.subtasks,
  refs: s.refs,
})

const proposedToDomainStep = (it: ProposedItem, i: number): Suggestion['steps'][number] => ({
  n: i + 1,
  blockId: it.blockId ?? null,
  type: it.type,
  content: it.content,
  title: it.title,
  desc: it.desc,
  command: it.command,
  level: it.level,
  why: it.why,
  section: it.section,
  subtasks: it.subtasks,
  refs: it.refs,
  imageRef: it.imageKey ?? null,
})

const mapSuggestion = (r: typeof suggestions.$inferSelect): Suggestion => ({
  id: r.id,
  listId: r.templateId,
  authorId: r.authorId,
  status: r.status,
  note: r.note,
  baseVersion: r.baseVersion,
  steps: (r.items as ProposedItem[]).map(proposedToDomainStep),
  createdAt: r.createdAt,
  resolvedAt: r.resolvedAt,
})

const mapSuggestionComment = (r: typeof suggestionComments.$inferSelect): SuggestionComment => ({
  id: r.id,
  suggestionId: r.suggestionId,
  authorId: r.authorId,
  body: r.body,
  createdAt: r.createdAt,
})

export const collabStore: CollabStore = {
  async openIssue(listId, authorId, title, body, labels) {
    const [r] = await db
      .insert(issues)
      .values({
        templateId: listId,
        authorId,
        title,
        body,
        labels,
        number: sql`(select coalesce(max(${issues.number}), 0) + 1 from ${issues} where ${issues.templateId} = ${listId})`,
      })
      .returning()
    return mapIssue(r)
  },

  async addIssueComment(issueId, authorId, body) {
    const [r] = await db.insert(issueComments).values({ issueId, authorId, body }).returning()
    return mapIssueComment(r)
  },

  async setIssueStatus(issueId, status) {
    await db
      .update(issues)
      .set({ status, closedAt: status === 'closed' ? new Date() : null, updatedAt: new Date() })
      .where(eq(issues.id, issueId))
  },

  async createSuggestion(listId, authorId, note, steps) {
    const [tpl] = await db.select({ currentVersion: templates.currentVersion }).from(templates).where(eq(templates.id, listId)).limit(1)
    const [r] = await db
      .insert(suggestions)
      .values({
        templateId: listId,
        authorId,
        note,
        baseVersion: tpl?.currentVersion ?? 1,
        items: steps.map(domainStepToProposed),
        // Номер в рамках списка — тем же приёмом, что у задач (одно место правды).
        number: sql`(select coalesce(max(number), 0) + 1 from suggestions where template_id = ${listId})`,
      })
      .returning()
    return mapSuggestion(r)
  },

  async addSuggestionComment(suggestionId, authorId, body) {
    const [r] = await db.insert(suggestionComments).values({ suggestionId, authorId, body }).returning()
    return mapSuggestionComment(r)
  },
}

// helper для дедупа комментаторов issue (используется в actions для fan-out нотификаций)
export async function issueCommenterIds(issueId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ id: issueComments.authorId }).from(issueComments).where(eq(issueComments.issueId, issueId))
  return rows.map((c) => c.id)
}

// helper для дедупа комментаторов правки
export async function suggestionCommenterIds(suggestionId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: suggestionComments.authorId })
    .from(suggestionComments)
    .where(eq(suggestionComments.suggestionId, suggestionId))
  return rows.map((c) => c.id)
}
