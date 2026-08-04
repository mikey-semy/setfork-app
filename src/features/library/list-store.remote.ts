import 'server-only'
import { Code, ConnectError, createClient } from '@connectrpc/connect'
import { coreTransport } from '@/shared/core-transport'
import { assertNoDestructiveSteps } from '@/core/domain/destructive-command'
import { ListWriteError } from '@/core'
import type { Contributor, CreateListInput, List, LocaleText, NewVersionInput, Step, StepRef, Version } from '@/core'
import {
  ListRead,
  ListWrite,
  type List as PbList,
  type LocaleText as PbLoc,
  type Step as PbStep,
  type Version as PbVersion,
} from '@/shared/gen/domain_read_pb'

// Remote READ-часть порта ListStore: Connect-ES → Rust ListRead (тот же сервер,
// что git-ядро; включается тем же флагом SETFORK_CORE_URL/ADDR). Маппинг proto→домен
// зеркалит конвенции domain_read.proto: '' = null, unix-ms = Date, LocaleText-обёртка.

const transport = coreTransport()
const client = createClient(ListRead, transport)
const writeClient = createClient(ListWrite, transport)

/** Вызов addVersion с переводом отказа по предусловию в доменную ошибку.
 *  Причину читаем из трейлера sf-reason (контракт ядра, AIP-193), а по коду
 *  ABORTED страхуемся: фронт выкатывается раньше ядра, и старая сборка причины
 *  ещё не шлёт. Текст ошибки НЕ разбираем — угадывание по подстрокам уже было
 *  проблемой (см. core.remote.ts). */
async function callAddVersion(req: Parameters<typeof writeClient.addVersion>[0]): Promise<PbVersion> {
  try {
    return await writeClient.addVersion(req)
  } catch (e) {
    if (e instanceof ConnectError && (e.metadata.get('sf-reason') === 'STALE' || e.code === Code.Aborted)) {
      throw new ListWriteError('stale')
    }
    throw e
  }
}

const loc = (l?: PbLoc): LocaleText => (l?.v ?? {}) as LocaleText
const orNull = (s: string): string | null => (s === '' ? null : s)
// content_json ('' = нет) → объект payload не-step блока.
const parseContent = (json: string): Record<string, unknown> => {
  if (!json) return {}
  try {
    const o = JSON.parse(json)
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

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
    // Блочная модель: type/content_json приходят из ядра (R2); '' = шаг.
    type: s.type || 'step',
    content: parseContent(s.contentJson),
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

const toPbLoc = (l: LocaleText) => ({ v: Object.fromEntries(Object.entries(l).filter(([, v]) => typeof v === 'string')) as Record<string, string> })

/** WRITE-методы порта ListStore поверх Rust ListWrite — ЕДИНСТВЕННЫЙ путь записи
 *  версий (Ф1 трека git-format, без флага): addVersion в ядре идёт git-first —
 *  сначала коммит vN на main, потом строки Postgres как проекция. Version.commitSha
 *  в ответе теперь настоящий sha этого коммита.
 *
 *  ⚠️ Порядок в экшенах: мета списка (title/desc/tags/ordered) обновляется ДО
 *  addVersion — канон list.json собирается ядром из templates в момент коммита.
 *
 *  Долг катовера закрыт 29.07: blockId и пометка «здесь нужен человек» тоже
 *  уезжают в ядро. Раньше их в proto не было, и запись через ядро СТЁРЛА бы
 *  идентичность блоков и пометку — молча, потому что набор шагов
 *  перезаписывается целиком, и поле, о котором путь не знает, просто исчезает. */
/**
 * Страж исполняемого выхода. Стоит ЗДЕСЬ, а не в экшенах, потому что это единственная
 * точка, через которую проходят все пути записи версии — редактор, MCP-публикация,
 * генерация, садовник. Проверка в экшене закрыла бы один путь и оставила остальные,
 * а именно так и появляются дыры: `sanitizeCommand` вызывается только из ИИ-веток и
 * поэтому не видит ни редактор, ни MCP, ни git.
 *
 * Известная незакрытая дыра: черновиковая ветка MCP пишет шаги прямым delete+insert
 * мимо ядра (отдельная находка ревью) — до её починки страж туда не достаёт.
 */
/** Шаг → proto NewStep. ОДИН маппер на addVersion и create: две копии уже разошлись
 *  однажды — поле, добавленное в одну, во второй забыли. */
const toPbStep = (s: NewVersionInput['steps'][number]) => ({
  title: toPbLoc(s.title),
  desc: toPbLoc(s.desc),
  command: s.command,
  level: s.level,
  why: toPbLoc(s.why),
  section: toPbLoc(s.section),
  subtasks: s.subtasks.map(toPbLoc),
  refs: s.refs.map((r) => ({ label: toPbLoc(r.label), url: r.url ?? '' })),
  imageRef: s.imageRef ?? '',
  // Блочная модель: type/content_json — только у не-step блоков.
  type: s.type && s.type !== 'step' ? s.type : '',
  contentJson: s.type && s.type !== 'step' ? JSON.stringify(s.content ?? {}) : '',
  // Идентичность блока сквозь версии (ADR-0013): '' = неизвестна.
  blockId: s.blockId ?? '',
  // Пометка «здесь нужен человек» — часть шага, а не украшение.
  needsHuman: s.needsHuman ?? false,
  needsHumanAsk: toPbLoc(s.needsHumanAsk ?? {}),
  // Разрушительный пункт: без этого поля запись через ядро снимала бы пометку —
  // набор шагов версии перезаписывается целиком.
  danger: s.danger ?? false,
})

export const listWriteRemote = {
  async addVersion(listId: string, input: NewVersionInput): Promise<Version> {
    assertNoDestructiveSteps(input.steps)
    const res = await callAddVersion({
      listId,
      note: input.note,
      authorId: input.authorId ?? '', // '' = null (parity с Postgres-адаптером/proto author_id)
      steps: input.steps.map(toPbStep),
      // Патч меты (Ф2a-довесок): message-поля имеют presence — отсутствие = «не трогать».
      meta: input.meta
        ? {
            title: input.meta.title ? toPbLoc(input.meta.title) : undefined,
            desc: input.meta.desc ? toPbLoc(input.meta.desc) : undefined,
            tags: input.meta.tags ? { v: input.meta.tags } : undefined,
            ordered: input.meta.ordered,
          }
        : undefined,
      // Версия, на которой основана правка: сверку делает ЯДРО в той же транзакции,
      // где строка списка уже заблокирована, — снаружи такой гарантии нет.
      expectedVersion: input.expectedVersion,
    })
    return toVersion(res)
  },
  async create(input: CreateListInput): Promise<List> {
    assertNoDestructiveSteps(input.steps)
    const res = await writeClient.create({
      ownerId: input.ownerId,
      slug: input.slug,
      title: toPbLoc(input.title),
      desc: toPbLoc(input.desc),
      tags: input.tags,
      ordered: input.ordered,
      visibility: input.visibility,
      status: input.status,
      origin: input.origin,
      forkedFromId: input.forkedFromId ?? '',
      note: input.note,
      steps: input.steps.map(toPbStep),
    })
    return toList(res)
  },
}
