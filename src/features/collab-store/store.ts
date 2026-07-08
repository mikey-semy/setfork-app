import 'server-only'
import { createClient } from '@connectrpc/connect'
import { coreTransport } from '@/shared/core-transport'
import type { CollabStore, Issue, IssueComment, Suggestion, SuggestionComment } from '@/core'
import { CollabWrite, type NewStep as PbStep } from '@/shared/gen/domain_read_pb'
import { collabStore as drizzleStore } from './adapter'

// Фасад порта CollabStore — точка катовера WRITE-мутаций issues/suggestions/
// comments на Rust CollabWrite при SETFORK_DOMAIN_WRITES=1 (тот же флаг, что
// ListWrite/CurationWrite). До включения — Drizzle-адаптер. Потребители
// импортируют ТОЛЬКО отсюда. Хелперы дедупа комментаторов — из adapter.
export { issueCommenterIds, suggestionCommenterIds } from './adapter'

const coreOn = !!process.env.SETFORK_CORE_URL
const remoteWrites = coreOn && process.env.SETFORK_DOMAIN_WRITES === '1'

// proto: int64 unix-ms (0 = null) → Date | null. Connect отдаёт bigint.
const toDate = (ms: bigint): Date => new Date(Number(ms))
const toDateN = (ms: bigint): Date | null => (ms ? new Date(Number(ms)) : null)

// Доменный шаг → NewStep (imageRef → image_ref '', LocaleText как есть).
function toPbStep(s: Suggestion['steps'][number]): PbStep {
  return {
    title: { v: s.title },
    desc: { v: s.desc },
    command: s.command,
    level: s.level,
    why: { v: s.why },
    section: { v: s.section },
    subtasks: s.subtasks.map((t) => ({ v: t })),
    refs: s.refs.map((r) => ({ label: { v: r.label }, url: r.url ?? '' })),
    imageRef: s.imageRef ?? '',
    // Блочная модель: type/content_json — только у не-step блоков.
    type: s.type && s.type !== 'step' ? s.type : '',
    contentJson: s.type && s.type !== 'step' ? JSON.stringify(s.content ?? {}) : '',
  } as PbStep
}

function fromPbStep(s: PbStep, i: number): Suggestion['steps'][number] {
  const isStep = !s.type || s.type === 'step'
  let content: Record<string, unknown> = {}
  if (!isStep && s.contentJson) {
    try {
      const o = JSON.parse(s.contentJson)
      if (o && typeof o === 'object') content = o as Record<string, unknown>
    } catch {
      content = {}
    }
  }
  return {
    n: i + 1,
    ...(isStep ? {} : { type: s.type, content }),
    title: s.title?.v ?? {},
    desc: s.desc?.v ?? {},
    command: s.command,
    level: s.level as Suggestion['steps'][number]['level'],
    why: s.why?.v ?? {},
    section: s.section?.v ?? {},
    subtasks: s.subtasks.map((t) => t.v ?? {}),
    refs: s.refs.map((r) => ({ label: r.label?.v ?? {}, ...(r.url ? { url: r.url } : {}) })),
    imageRef: s.imageRef || null,
  }
}

function remote(): Partial<CollabStore> {
  const client = createClient(CollabWrite, coreTransport())
  return {
    async openIssue(listId, authorId, title, body, labels): Promise<Issue> {
      const r = await client.openIssue({ listId, authorId, title, body, labels })
      return {
        id: r.id,
        listId: r.listId,
        number: r.number,
        authorId: r.authorId,
        title: r.title,
        body: r.body,
        status: r.status as Issue['status'],
        labels: r.labels,
        createdAt: toDate(r.createdAt),
        updatedAt: toDate(r.updatedAt),
        closedAt: toDateN(r.closedAt),
      }
    },
    async addIssueComment(issueId, authorId, body): Promise<IssueComment> {
      const r = await client.addIssueComment({ issueId, authorId, body })
      return { id: r.id, issueId: r.issueId, authorId: r.authorId, body: r.body, createdAt: toDate(r.createdAt) }
    },
    async setIssueStatus(issueId, status): Promise<void> {
      await client.setIssueStatus({ issueId, status })
    },
    async createSuggestion(listId, authorId, note, steps): Promise<Suggestion> {
      const r = await client.createSuggestion({ listId, authorId, note, steps: steps.map(toPbStep) })
      return {
        id: r.id,
        listId: r.listId,
        authorId: r.authorId,
        status: r.status as Suggestion['status'],
        note: r.note,
        baseVersion: r.baseVersion,
        steps: r.steps.map(fromPbStep),
        createdAt: toDate(r.createdAt),
        resolvedAt: toDateN(r.resolvedAt),
      }
    },
    async addSuggestionComment(suggestionId, authorId, body): Promise<SuggestionComment> {
      const r = await client.addSuggestionComment({ suggestionId, authorId, body })
      return { id: r.id, suggestionId: r.suggestionId, authorId: r.authorId, body: r.body, createdAt: toDate(r.createdAt) }
    },
  }
}

export const collabStore: CollabStore = { ...drizzleStore, ...(remoteWrites ? remote() : {}) }
