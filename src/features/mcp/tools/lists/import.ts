import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, templates } from '@/shared/db'
import { rateLimit } from '@/shared/rate-limit'
import { classifySkillLicense, type SkillLicense } from '@/core/domain/skill-license'
import { parseSkillMd } from '@/features/library/skill-parse'
import { fetchGithubSkill, parseGithubSkillUrl } from '@/features/library/skill-import/github'
import { mcpPublishSkill } from './skill'
import { mcpDeleteList } from './delete'

/**
 * ИМПОРТ ЧУЖОГО СКИЛЛА С GITHUB — одна точка на сайт, MCP и `sf`.
 *
 * Живёт в слое MCP, потому что собирает список тем же `mcpPublishSkill`; сайт зовёт его из
 * `app/new/actions` (слою app это можно, библиотеке — нет).
 *
 * Решение владельца 25.09.2026: импортировать можно любой скилл, но ВИДИМОСТЬ СЛЕДУЕТ
 * ЛИЦЕНЗИИ. Открытая — черновик публичный (публикует человек, как обычно), в списке
 * указаны источник и лицензия. Нет лицензии, она закрытая или неясная — черновик приватный
 * и таким остаётся: публичным его не сделать ни настройками, ни копией (см. `sourceLicenseOpen`).
 *
 * Сам список собирается ТЕМ ЖЕ путём, что `publish_skill`: разбор SKILL.md в блоки, шапка,
 * файлы одной версией, стражи содержимого (команды, ключи). Своя сборка здесь однажды
 * разошлась бы с ним.
 */

/**
 * Сколько импортов в час на человека: каждый — несколько запросов к GitHub с общего IP
 * сервера (без токена — 60 в час на всех). Поэтому попытка, дошедшая до GitHub, считается
 * и при его отказе; опечатка в адресе — нет: её отсекает разбор до счётчика.
 */
const IMPORTS_PER_HOUR = 10

export interface ImportedSkill {
  ref: string
  license: SkillLicense
  /** Список приватный, потому что лицензия не открытая. */
  privateOnly: boolean
  sourceUrl: string
  skipped: { path: string; why: string }[]
  parseNotes?: string[]
}

export async function importSkillFromGithub(userId: string, url: string): Promise<ImportedSkill | { error: string }> {
  const ref = parseGithubSkillUrl(url)
  if ('error' in ref) return ref
  if (!(await rateLimit(`skill-import:${userId}`, IMPORTS_PER_HOUR, 60 * 60_000)).ok) {
    return { error: `too many imports — at most ${IMPORTS_PER_HOUR} an hour` }
  }
  const fetched = await fetchGithubSkill(ref, process.env.SETFORK_GITHUB_TOKEN || undefined)
  if ('error' in fetched) return fetched

  const header = parseSkillMd(fetched.skillMd).header
  const license = classifySkillLicense(typeof header.license === 'string' ? header.license : undefined, fetched.licenseText)
  const privateOnly = !license.open

  const res = await mcpPublishSkill(userId, {
    skillMd: fetched.skillMd,
    files: fetched.files.map((f) => ({ path: f.path, content: new TextDecoder().decode(f.content), executable: f.executable })),
    visibility: privateOnly ? 'private' : 'public',
    note: `imported from ${fetched.sourceUrl}`,
  })
  if ('error' in res) return { error: res.error as string }
  const createdRef = (res as { ref: string }).ref
  const [handle, slug] = createdRef.split('/')
  // Источник и вердикт — ОТДЕЛЬНОЙ записью после создания (ядро этих колонок не знает).
  // Не легли — список удаляется: приватный импорт без записанного вердикта был бы открыт
  // для «сделать публичным» (canBePublic видит источник только по этой записи).
  try {
    await db
      .update(templates)
      .set({ sourceUrl: fetched.sourceUrl, sourceLicense: license.id, sourceLicenseOpen: license.open })
      .where(and(eq(templates.ownerId, userId), eq(templates.slug, slug)))
  } catch (e) {
    await mcpDeleteList(userId, handle, slug, true).catch(() => {})
    throw e
  }

  const notes = (res as { parseNotes?: string[] }).parseNotes
  return {
    ref: createdRef,
    license,
    privateOnly,
    sourceUrl: fetched.sourceUrl,
    skipped: fetched.skipped,
    ...(notes?.length ? { parseNotes: notes } : {}),
  }
}

/** Импорт чужого скилла с GitHub — через ту же службу, что форма сайта и `sf skill import`. */
export async function mcpImportSkill(userId: string, input: { url: string }) {
  const res = await importSkillFromGithub(userId, input.url)
  if ('error' in res) return res
  return {
    ...res,
    note: res.privateOnly
      ? `Imported as a PRIVATE draft: ${res.license.id ? `the license "${res.license.id}"` : 'no license'} does not allow republishing, so this list stays private (owner's rule). Only you see it.`
      : `Imported as a draft under ${res.license.id} with the source credited. Publish it with publish_lists to make it installable.`,
  }
}
