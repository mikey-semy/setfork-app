import 'server-only'
import { eq } from 'drizzle-orm'
import { db, templates } from '@/shared/db'
import { resolveListById } from '@/shared/db/resolve-list'
import type { Lang } from '@/shared/i18n'
import { buildReleaseChangelog } from '@/features/releases/changelog'
import { publishRelease, type ReleaseOutcome } from '@/features/releases/core'
import { countReleases, getLatestReleaseId, getReleases } from '@/features/releases/queries'
import { SITE_URL, mcpCanView, resolveListRefOrMoved } from './shared'

/**
 * РЕЛИЗЫ ЧЕРЕЗ MCP: выпустить релиз из версии списка и прочитать уже выпущенные.
 *
 * Правил здесь нет — они в `features/releases/core`, одни с формой на сайте: тег,
 * запрет имён `vN`, существование версии, уникальность тега, git-тег раньше записи в
 * базу. Здесь только перевод: ссылка → список, отказ → фраза, результат → адрес.
 *
 * Зачем агенту: заметки релиза — это Markdown на полстраницы, и набирать их в поле
 * формы с телефона неудобно, а агент, который только что делал изменения, знает, что
 * в них вошло. Имена полей — как у REST GitHub (`POST /repos/.../releases`: `tag_name`,
 * `name`, `body`, `prerelease`, `generate_release_notes`), в нашей записи: `tag`,
 * `title`, `notes`. Черновиков релиза (`draft`) у нас нет — релиз публикуется сразу.
 */

const REFUSAL: Record<Exclude<ReleaseOutcome, { ok: true }>['reason'], string> = {
  not_found: 'list not found',
  forbidden: 'only the list owner or a collaborator can publish releases',
  badtag: 'tag must be 1–40 characters: letters, digits, dot, dash or underscore (e.g. "v1.2.0")',
  vreserved: 'tags like "v12" (v + digits only) are reserved for automatic version tags — use e.g. "v12.0" or "1.2.0"',
  badversion: 'no such version of this list — get_list shows the current one',
  tagtaken: 'a release with this tag already exists in this list',
  tagfail: 'the git core could not create the tag — nothing was published; retry later',
}

const releasesUrl = (owner: string, slug: string) => `${SITE_URL}/${owner}/${slug}/releases`

/** Список по ссылке агента плюс право его видеть — без него нельзя ни читать, ни отказать. */
async function visibleList(userId: string, ref: string) {
  const found = await resolveListRefOrMoved(ref)
  if (!found) return null
  const tpl = await resolveListById(found.id)
  if (!tpl || !(await mcpCanView(tpl, userId))) return null
  return found
}

/** ВЫПУСТИТЬ РЕЛИЗ из версии списка. */
export async function mcpCreateRelease(
  userId: string,
  input: {
    list: string
    tag: string
    version?: number
    title?: string
    notes?: string
    prerelease?: boolean
    generateNotes?: boolean
    notesLang?: Lang
  },
) {
  const found = await visibleList(userId, input.list)
  if (!found) return { error: REFUSAL.not_found }

  let notes = input.notes ?? ''
  if (input.generateNotes) {
    // Как у GitHub: свой текст ИДЁТ ПЕРВЫМ, собранное из диффа — под ним.
    const [row] = await db.select({ v: templates.currentVersion }).from(templates).where(eq(templates.id, found.id)).limit(1)
    const generated = await buildReleaseChangelog(found.id, input.version ?? row?.v ?? 0, input.notesLang ?? 'en')
    notes = [notes.trim(), generated].filter(Boolean).join('\n\n')
  }

  const res = await publishRelease(userId, found.id, {
    version: input.version,
    tag: input.tag ?? '',
    title: input.title,
    notes,
    prerelease: input.prerelease,
  })
  if (!res.ok) return { error: REFUSAL[res.reason] }
  return {
    ref: `${res.owner}/${res.slug}`,
    tag: res.tag,
    version: res.version,
    url: releasesUrl(res.owner, res.slug),
    movedTo: found.movedTo ?? undefined,
    note: `Published — the git tag "${res.tag}" points at version ${res.version}, and the release is in the Atom feed.`,
  }
}

/** РЕЛИЗЫ СПИСКА, новые сверху, с пометкой последнего (не пред-релиза). */
export async function mcpListReleases(userId: string, input: { list: string; limit?: number; page?: number }) {
  const found = await visibleList(userId, input.list)
  if (!found) return { error: REFUSAL.not_found }
  const limit = input.limit ?? 10
  const page = input.page ?? 1
  const [rows, total, latestId] = await Promise.all([
    getReleases(found.id, { limit, offset: (page - 1) * limit }),
    countReleases(found.id),
    getLatestReleaseId(found.id),
  ])
  return {
    ref: `${found.ownerHandle}/${found.slug}`,
    url: releasesUrl(found.ownerHandle, found.slug),
    total,
    page,
    ...(page * limit < total ? { nextPage: page + 1 } : {}),
    releases: rows.map((r) => ({
      tag: r.tag,
      version: r.version,
      title: r.title || undefined,
      notes: r.notes || undefined,
      prerelease: r.prerelease || undefined,
      latest: r.id === latestId || undefined,
      author: r.authorHandle,
      createdAt: r.createdAt.toISOString(),
    })),
  }
}
