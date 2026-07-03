import 'server-only'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { Contributor, List, ListStore, LocaleText, Step, StepRef, Version } from '@/core'
import { db, steps as stepsTable, templates, templateVersions, users } from '@/shared/db'
import { getContributors as getContributorsQuery } from '@/features/library/queries'

// Drizzle-адаптер порта ListStore (см. @/core/ports). Мапит строки БД в доменные
// сущности. Пост-MVP реализуется на Rust (sqlx) за тем же портом.

type TplRow = typeof templates.$inferSelect
type VerRow = typeof templateVersions.$inferSelect
type StepRow = typeof stepsTable.$inferSelect

const loc = (v: unknown): LocaleText => (v ?? {}) as LocaleText

function toList(r: TplRow): List {
  return {
    id: r.id,
    repositoryId: r.id, // synthetic solo-repo, пока нет таблицы repositories
    ownerId: r.ownerId,
    slug: r.slug,
    title: loc(r.title),
    desc: loc(r.desc),
    tags: r.tags,
    ordered: r.ordered,
    status: r.status,
    visibility: r.visibility,
    moderation: r.moderation,
    moderationReason: r.moderationReason,
    verified: r.verified,
    pinned: r.pinned,
    origin: r.origin,
    forkedFromId: r.forkedFromId ?? null,
    currentVersion: r.currentVersion,
    starsCount: r.starsCount,
    forksCount: r.forksCount,
    runsCount: r.runsCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

function toVersion(v: VerRow): Version {
  return { id: v.id, listId: v.templateId, version: v.version, note: v.note, commitSha: null, createdAt: v.createdAt }
}

function toStep(s: StepRow): Step {
  return {
    id: s.id,
    versionId: s.versionId,
    n: s.n,
    title: loc(s.title),
    desc: loc(s.desc),
    command: s.command,
    level: s.level,
    why: loc(s.why),
    section: loc(s.section),
    subtasks: (s.subtasks ?? []) as LocaleText[],
    refs: (s.refs ?? []) as StepRef[],
    imageRef: s.imageKey ?? null,
  }
}

export const listStore: ListStore = {
  async getBySlug(owner, slug) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.handle, owner)).limit(1)
    if (!u) return null
    const [row] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.ownerId, u.id), eq(templates.slug, slug)))
      .limit(1)
    return row ? toList(row) : null
  },

  async listVersions(listId) {
    const rows = await db
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.templateId, listId))
      .orderBy(desc(templateVersions.version))
    return rows.map(toVersion)
  },

  async getVersion(listId, version) {
    const [v] = await db
      .select()
      .from(templateVersions)
      .where(and(eq(templateVersions.templateId, listId), eq(templateVersions.version, version)))
      .limit(1)
    if (!v) return null
    const rows = await db.select().from(stepsTable).where(eq(stepsTable.versionId, v.id)).orderBy(asc(stepsTable.n))
    return { version: toVersion(v), steps: rows.map(toStep) }
  },

  async addVersion(listId, input) {
    const [tpl] = await db.select({ currentVersion: templates.currentVersion }).from(templates).where(eq(templates.id, listId)).limit(1)
    if (!tpl) throw new Error('addVersion: list not found')
    const newVersion = tpl.currentVersion + 1
    const [ver] = await db
      .insert(templateVersions)
      .values({ templateId: listId, version: newVersion, note: input.note })
      .returning()
    if (input.steps.length) {
      await db.insert(stepsTable).values(
        input.steps.map((s, i) => ({
          versionId: ver.id,
          n: i + 1,
          title: s.title,
          desc: s.desc,
          command: s.command,
          hasImage: !!s.imageRef,
          imageKey: s.imageRef ?? null,
          level: s.level,
          why: s.why,
          section: s.section,
          subtasks: s.subtasks,
          refs: s.refs,
        })),
      )
    }
    await db.update(templates).set({ currentVersion: newVersion, updatedAt: new Date() }).where(eq(templates.id, listId))
    return toVersion(ver)
  },

  async getContributors(listId) {
    const [tpl] = await db.select({ ownerId: templates.ownerId }).from(templates).where(eq(templates.id, listId)).limit(1)
    if (!tpl) return []
    const rows = await getContributorsQuery(listId, tpl.ownerId)
    return rows.map((c): Contributor => ({ handle: c.handle, avatarRef: c.avatarUrl, accepted: c.accepted }))
  },
}
