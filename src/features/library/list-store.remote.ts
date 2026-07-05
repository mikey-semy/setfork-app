import 'server-only'
import { createClient } from '@connectrpc/connect'
import { createGrpcTransport } from '@connectrpc/connect-node'
import type { Contributor, List, LocaleText, Step, StepRef, Version } from '@/core'
import {
  ListRead,
  type List as PbList,
  type LocaleText as PbLoc,
  type Step as PbStep,
  type Version as PbVersion,
} from '@/features/git/gen/domain_read_pb'

// Remote READ-часть порта ListStore: Connect-ES → Rust ListRead (тот же сервер,
// что git-ядро; включается тем же флагом SETFORK_CORE_URL/ADDR). Маппинг proto→домен
// зеркалит конвенции domain_read.proto: '' = null, unix-ms = Date, LocaleText-обёртка.

const addr = process.env.SETFORK_CORE_ADDR ?? '127.0.0.1:50051'
const transport = createGrpcTransport({ baseUrl: `http://${addr}` })
const client = createClient(ListRead, transport)

const loc = (l?: PbLoc): LocaleText => (l?.v ?? {}) as LocaleText
const orNull = (s: string): string | null => (s === '' ? null : s)

function toList(l: PbList): List {
  return {
    id: l.id,
    repositoryId: l.repositoryId,
    ownerId: l.ownerId,
    slug: l.slug,
    title: loc(l.title),
    desc: loc(l.desc),
    tags: l.tags,
    ordered: l.ordered,
    status: l.status as List['status'],
    visibility: l.visibility as List['visibility'],
    moderation: l.moderation as List['moderation'],
    moderationReason: orNull(l.moderationReason),
    verified: l.verified,
    pinned: l.pinned,
    origin: l.origin as List['origin'],
    forkedFromId: orNull(l.forkedFromId),
    currentVersion: l.currentVersion,
    starsCount: l.starsCount,
    forksCount: l.forksCount,
    runsCount: l.runsCount,
    createdAt: new Date(Number(l.createdAtMs)),
    updatedAt: new Date(Number(l.updatedAtMs)),
  }
}

function toVersion(v: PbVersion): Version {
  return {
    id: v.id,
    listId: v.listId,
    version: v.version,
    note: v.note,
    commitSha: orNull(v.commitSha),
    createdAt: new Date(Number(v.createdAtMs)),
  }
}

function toStep(s: PbStep): Step {
  return {
    id: s.id,
    versionId: s.versionId,
    n: s.n,
    title: loc(s.title),
    desc: loc(s.desc),
    command: s.command,
    level: s.level as Step['level'],
    why: loc(s.why),
    section: loc(s.section),
    subtasks: s.subtasks.map((t) => loc(t)),
    refs: s.refs.map((r): StepRef => ({ label: loc(r.label), ...(r.url ? { url: r.url } : {}) })),
    imageRef: orNull(s.imageRef),
  }
}

/** READ-методы порта ListStore поверх Rust ListRead. */
export const listReadRemote = {
  async getBySlug(owner: string, slug: string): Promise<List | null> {
    const res = await client.getList({ owner, slug })
    return res.found && res.list ? toList(res.list) : null
  },

  async listVersions(listId: string): Promise<Version[]> {
    const res = await client.listVersions({ id: listId })
    return res.versions.map(toVersion)
  },

  async getVersion(listId: string, version: number): Promise<{ version: Version; steps: Step[] } | null> {
    const res = await client.getVersion({ listId, version })
    if (!res.found || !res.version) return null
    return { version: toVersion(res.version), steps: res.steps.map(toStep) }
  },

  async getContributors(listId: string): Promise<Contributor[]> {
    const res = await client.getContributors({ id: listId })
    return res.contributors.map((c) => ({ handle: c.handle, avatarRef: orNull(c.avatarRef), accepted: c.accepted }))
  },
}
