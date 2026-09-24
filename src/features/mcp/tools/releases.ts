import 'server-only'
import { resolveListById } from '@/shared/db/resolve-list'
import { isPubliclyVisible } from '@/core'
import type { Lang } from '@/shared/i18n'
import { publishRelease, type ReleaseOutcome } from '@/features/releases/core'
import { countReleases, getLatestReleaseId, getReleases } from '@/features/releases/queries'
import { SITE_URL, mcpCanView, resolveListRefOrMoved } from './shared'

/**
 * РЕЛИЗЫ ЧЕРЕЗ MCP: выпустить релиз из версии списка и прочитать уже выпущенные.
 *
 * Правил здесь нет — они в `features/releases/core`, одни с формой на сайте: видимость,
 * право, архив, имя тега, версия, занятость тега в базе и в git, сборка заметок. Здесь
 * только перевод: ссылка → список, отказ → фраза, результат → адрес.
 *
 * Зачем агенту: заметки релиза — это Markdown на полстраницы, и набирать их в поле
 * формы с телефона неудобно, а агент, который только что делал изменения, знает, что
 * в них вошло. Имена полей — как у REST GitHub (`POST /repos/.../releases`: `tag_name`,
 * `name`, `body`, `prerelease`, `generate_release_notes`), в нашей записи: `tag`,
 * `title`, `notes`. Черновиков релиза (`draft`) у нас нет — релиз публикуется сразу,
 * поэтому выпуск идёт в ДВА шага, как `publish_draft`: без `confirm` — только отчёт.
 */

const REFUSAL: Record<Exclude<ReleaseOutcome, { ok: true }>['reason'], string> = {
  not_found: 'list not found',
  forbidden: 'only the list owner or a collaborator can publish releases',
  readonly: 'the list is archived or frozen — releases cannot be published in it; retrying will not help',
  badtag:
    'bad tag: 1–40 characters of letters, digits, ".", "-", "_"; it must not start with "-", end with "." or contain ".." (e.g. "v1.2.0")',
  vreserved: 'tags like "v12" (v + digits only) are reserved for automatic version tags — use e.g. "v12.0" or "1.2.0"',
  badversion: 'no such version of this list — get_list shows the current one',
  tagtaken:
    'this tag is taken: a release with it exists, or a git tag with this name points at another version — pick another tag (list_releases shows the used ones)',
  tagfail: 'the git core did not answer or could not create the tag — nothing was published; retrying later is safe',
}

const releasesUrl = (owner: string, slug: string) => `${SITE_URL}/${owner}/${slug}/releases`

/** Список по ссылке агента плюс право его видеть — без него нельзя ни читать, ни отказать. */
async function visibleList(userId: string, ref: string) {
  const found = await resolveListRefOrMoved(ref)
  if (!found) return null
  const tpl = await resolveListById(found.id)
  if (!tpl || !(await mcpCanView(tpl, userId))) return null
  return { ...found, tpl }
}

/** ВЫПУСТИТЬ РЕЛИЗ из версии списка — два шага: отчёт, затем `confirm: true`. */
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
    confirm?: boolean
  },
) {
  const found = await visibleList(userId, input.list)
  if (!found) return { error: REFUSAL.not_found }
  const ref = `${found.ownerHandle}/${found.slug}`
  const isPublic = isPubliclyVisible(found.tpl)
  const movedTo = found.movedTo ?? undefined

  if (!input.confirm) {
    // Отчёт без записи: что будет выпущено и что это необратимо наружу. Проверки тега и
    // права сделает сам выпуск — повторять их здесь значило бы завести вторую копию.
    return {
      ref,
      movedTo,
      wouldPublish: {
        tag: input.tag,
        version: input.version ?? 'current',
        title: input.title ?? '',
        prerelease: input.prerelease === true,
        generateNotes: input.generateNotes === true,
      },
      visibleTo: isPublic ? 'everyone (and the Atom feed)' : 'only those who can see this list',
      note:
        'Nothing was published. A release creates a git tag that also goes to the list mirrors; deleting the release on the site does NOT remove the tag. Call again with confirm:true to publish.',
    }
  }

  const res = await publishRelease(userId, found.id, {
    version: input.version,
    tag: input.tag ?? '',
    title: input.title,
    notes: input.notes,
    prerelease: input.prerelease,
    generateNotes: input.generateNotes ? (input.notesLang ?? 'en') : undefined,
  })
  if (!res.ok) return { error: REFUSAL[res.reason] }
  return {
    ref: `${res.owner}/${res.slug}`,
    tag: res.tag,
    version: res.version,
    url: releasesUrl(res.owner, res.slug),
    movedTo,
    // Что записано на самом деле: с собранной частью, после обрезки. Агент не видит
    // страницу — без этого он не узнал бы ни пустой генерации, ни потерянного хвоста.
    notes: res.notes,
    ...(res.truncated ? { truncated: true, truncatedNote: 'notes were longer than 50000 characters and were cut' } : {}),
    note: isPublic
      ? `Published — the git tag "${res.tag}" points at version ${res.version}; the release is public and in the Atom feed.`
      : `Published — the git tag "${res.tag}" points at version ${res.version}; the list is not public, so only those who can see it see the release.`,
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
    movedTo: found.movedTo ?? undefined,
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
