// Публикация скилла через MCP: блоки списка и файлы автора — ОДНОЙ версией.
// Причина измениться у модуля одна — как агент приносит скилл целиком (ADR-0028).
//
// Раньше скилл собирался в два приёма: текст — `create_list`/`patch_list`, файлы —
// только `git push`. Между ними жила версия без файлов, и её успевали поставить. Здесь
// оба приезжают одним коммитом: новый список рождается сразу с файлами, у существующего
// набор меняется той же версией, что и блоки.
//
// ⚠️ ФАЙЛЫ — ДОПОЛНЕНИЕМ, А НЕ ЗАМЕНОЙ. Прочитать текущий набор агенту до недавнего было
// нечем, и «полный набор на входе» стирал всё, чего агент не знал: попросили добавить
// один скрипт — исчезли три, пришедшие пушем, а «вернуть версию» файлов не возвращает.
// Поэтому `files` добавляет и заменяет названные, `removeFiles` удаляет названные, а
// замена целиком — только явным `replaceFiles: true`. Ядру уходит собранный ПОЛНЫЙ набор:
// его контракт (замена) проще и один на всех, а слияние — забота того, кто знает намерение.
//
// Своих правил нет: владение, архив, сверка версии, страж исполняемого — в общих путях
// `create`/`write`; правило дерева судит ядро, тем же кодом, что на push. Здесь — разбор
// входа, слияние набора и дружелюбный ранний отказ.

import 'server-only'
import { and, eq } from 'drizzle-orm'
import { isPubliclyVisible, type AuthoredFile } from '@/core'
import { db, listDrafts, templates } from '@/shared/db'
import { detectTextLang } from '@/shared/lib/translit'
import { AUTHORED_PATH, fitsArchive } from '@/features/library/skill'
import { parseSkillMd } from '@/features/library/skill-parse'
import { assignCatalogByName } from '@/features/catalogs/assign'
import { gitCore } from '@/features/git/core'
import { SITE_URL, detailByRefOrMoved, toProposed, type McpItemInput } from '../shared'
import { mcpCreateList, normalizeTags } from './create'
import { rowsToProposed } from './patch-block'
import { headVersion } from './base-version'
import { authoredError, contentError, ownedList, writeProposed } from './write'

export interface McpSkillFileInput {
  path: string
  content: string
  /** 'utf8' (по умолчанию) — текст как есть; 'base64' — точные байты. */
  encoding?: 'utf8' | 'base64'
  /** Не задано — у существующего файла прежний режим, у нового — обычный. */
  executable?: boolean
}

export interface McpPublishSkillInput {
  /** Существующий список «handle/slug» — обновить; не задан — создать новый. */
  list?: string
  /** Для существующего — версия, от которой собрана правка (get_list). Обязательна. */
  baseVersion?: number
  title?: string
  desc?: string
  tags?: string[]
  ordered?: boolean
  lang?: string
  catalog?: string
  /** Блоки. У существующего списка не заданы — остаются текущие. */
  items?: McpItemInput[]
  /** Исходный SKILL.md целиком: блоки, название и описание берутся из него (если не заданы
   *  явно). Разбор — `features/library/skill-parse`, обратный экспорту. */
  skillMd?: string
  /** Добавить или заменить эти файлы; прочие остаются. */
  files?: McpSkillFileInput[]
  /** Удалить эти файлы (пути). */
  removeFiles?: string[]
  /** true — набор файлов ЗАМЕНЯЕТСЯ целиком на `files` (прочие удаляются). */
  replaceFiles?: boolean
  note?: string
}

/** Символы, которые ломают отображение имени или распаковку: управляющие, `\` и символы
 *  направления текста. Правило то же, что у ядра (`input_name_ok`); здесь — ранний отказ. */
const BAD_NAME_CHAR = /[\p{Cc}\\‎‏‪-‮⁦-⁩]/u
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

function pathProblem(path: string, executable: boolean | undefined): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (!AUTHORED_PATH.test(path) || path.split('/').includes('..'))
    return `bad file path "${path}": files live directly in scripts/, references/ or assets/ — one level, no subfolders`
  if (name.startsWith('.')) return `bad file name "${path}": a name must not start with a dot`
  if (BAD_NAME_CHAR.test(name)) return `bad file name "${path}": control, backslash or text-direction characters`
  // Длиннее — лёг бы в дерево, но не в архив скилла: установился бы скилл без файла.
  if (!fitsArchive(path)) return `file name too long "${path}": at most 100 bytes (about 50 Cyrillic letters)`
  if (executable && !path.startsWith('scripts/')) return `"${path}" cannot be executable: only files in scripts/ may be`
  return null
}

/** Вход → байты с ранним отказом. Число и размер не проверяем: их судит ядро, а вторая
 *  копия пределов здесь однажды разошлась бы с его константами. */
export function decodeSkillFiles(files: McpSkillFileInput[]): { files: (AuthoredFile & { execGiven: boolean })[] } | { error: string } {
  const seen = new Set<string>()
  const out: (AuthoredFile & { execGiven: boolean })[] = []
  for (const f of files) {
    const path = (f.path ?? '').trim()
    const problem = pathProblem(path, f.executable)
    if (problem) return { error: problem }
    if (seen.has(path)) return { error: `the file "${path}" is listed twice` }
    seen.add(path)
    let content: Uint8Array
    if (f.encoding === 'base64') {
      const raw = (f.content ?? '').replace(/\s+/g, '')
      // Buffer.from молча глотает мусор: текст с ошибочным encoding стал бы «бинарным».
      if (!BASE64.test(raw) || raw.length % 4 !== 0) return { error: `"${path}" is not valid base64 — send text with encoding "utf8"` }
      content = new Uint8Array(Buffer.from(raw, 'base64'))
    } else {
      content = new TextEncoder().encode(f.content ?? '')
    }
    // Двоичное дерево скилла не примет (ни с сайта, ни пушем): признак тот же, что у git.
    if (content.includes(0)) return { error: `"${path}" is a binary file — a skill keeps text only` }
    out.push({ path, content, executable: f.executable === true, execGiven: f.executable !== undefined })
  }
  return { files: out }
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

/** Текущий набор + правка → полный набор для ядра и отчёт о разнице. */
export function mergeSkillFiles(
  current: AuthoredFile[],
  given: (AuthoredFile & { execGiven: boolean })[],
  remove: string[],
  replace: boolean,
): { files: AuthoredFile[]; added: string[]; changed: string[]; removed: string[]; unknown: string[] } {
  const byPath = new Map(current.map((f) => [f.path, f]))
  const next = new Map<string, AuthoredFile>(replace ? [] : current.map((f) => [f.path, f]))
  const added: string[] = []
  const changed: string[] = []
  for (const g of given) {
    const was = byPath.get(g.path)
    // Режим прежнего файла переносим только в scripts/: исполняемые разрешены лишь там, а
    // файл, пришедший пушем раньше правила (assets/x.sh с 755), иначе валил бы всю запись.
    const executable = g.execGiven ? g.executable : g.path.startsWith('scripts/') ? (was?.executable ?? false) : false
    next.set(g.path, { path: g.path, content: g.content, executable })
    if (!was) added.push(g.path)
    else if (!same(was.content, g.content) || was.executable !== executable) changed.push(g.path)
  }
  const unknown: string[] = []
  for (const p of remove) {
    if (next.has(p)) next.delete(p)
    else unknown.push(p)
  }
  const removed = current.map((f) => f.path).filter((p) => !next.has(p))
  return { files: [...next.values()], added, changed, removed, unknown }
}

/** Метка «Скилл» — publish_skill ставит её сам: намерение названо вызовом, как у GitHub
 *  шаблон ставят галочкой. Снять её можно в настройках; вызов её не снимает. */
const markSkill = (where: ReturnType<typeof eq>) => db.update(templates).set({ isSkill: true }).where(where)

const installLine = (ref: string) => `npx skills add ${SITE_URL}/${ref}/skill.tar.gz`

/** Ядро не подтвердило набор после записи: версия уже лежит, но без файлов. Правду — агенту. */
const notApplied = (what: string) => ({
  error: `${what} was written WITHOUT the files: the git core was replaced by one that does not take them between the check and the write. Nothing else is wrong — call publish_skill again for the files once the core is updated.`,
})

/** ОПУБЛИКОВАТЬ СКИЛЛ: блоки + файлы автора одной версией. */
export async function mcpPublishSkill(userId: string, rawInput: McpPublishSkillInput) {
  const decoded = decodeSkillFiles(rawInput.files ?? [])
  if ('error' in decoded) return decoded
  // SKILL.md → блоки, название, описание. Явные поля главнее: агент мог поправить описание.
  const parsed = rawInput.skillMd ? parseSkillMd(rawInput.skillMd) : null
  if (parsed && rawInput.items) return { error: 'pass either skillMd or items, not both — skillMd already becomes the blocks' }
  if (parsed && !parsed.items.length) return { error: 'the SKILL.md has no body to turn into blocks' }
  const input: McpPublishSkillInput = parsed
    ? {
        ...rawInput,
        title: rawInput.title ?? parsed.title,
        desc: rawInput.desc ?? (parsed.description || undefined),
        items: parsed.items as McpItemInput[],
      }
    : rawInput
  // Что из исходника в список не попадает (license, compatibility, metadata…) — называем,
  // а не теряем молча; хранение шапки — следующий шаг трека.
  const headerKeys = parsed ? Object.keys(parsed.header) : []
  const parseNotes = parsed
    ? [
        ...parsed.warnings,
        ...(headerKeys.length ? [`not stored yet from the SKILL.md header: ${headerKeys.join(', ')}`] : []),
      ]
    : []

  if (!input.list) {
    if (!input.title?.trim()) return { error: 'title is required for a new skill (or pass list to update an existing one)' }
    if (input.removeFiles?.length) return { error: 'removeFiles makes no sense for a new skill — it has no files yet' }
    const authored = decoded.files.map(({ path, content, executable }) => ({ path, content, executable }))
    try {
      const res = await mcpCreateList(userId, {
        title: input.title,
        desc: input.desc,
        tags: input.tags,
        ordered: input.ordered,
        items: input.items ?? [],
        lang: input.lang,
        catalog: input.catalog,
        // У нового списка «без файлов» — это просто без файлов: слать пустой набор ядру
        // незачем, а старое ядро на нём отказало бы скиллу, которому файлы и не нужны.
        authored: authored.length ? authored : undefined,
      })
      if ('error' in res) return res
      await markSkill(and(eq(templates.ownerId, userId), eq(templates.slug, res.ref.split('/')[1]))!)
      if (authored.length && res.authoredApplied !== true) return notApplied(`the draft ${res.ref} (version 1)`)
      const { authoredApplied: _applied, ...rest } = res
      return {
        ...rest,
        ...(parseNotes.length ? { parseNotes } : {}),
        version: 1,
        files: { added: authored.map((f) => f.path) },
        url: `${SITE_URL}/${res.ref}`,
        note: `Created as a draft with its files in version 1 — only you see it. To let agents install it, publish it with publish_lists (confirm:true); moderation may hold a new author's list for review first. After that: ${installLine(res.ref)}`,
      }
    } catch (e) {
      const refused = contentError(e) ?? authoredError(e)
      if (refused) return refused
      throw e
    }
  }

  const [handle, slug] = input.list.split('/')
  if (!handle || !slug) return { error: 'list must be "handle/slug"' }
  const found = await ownedList(userId, handle, slug)
  if ('error' in found) return found
  const { tpl } = found
  if (input.baseVersion === undefined) return { error: 'baseVersion is required to update a list — take it from get_list' }
  const current = headVersion(tpl)
  if (input.baseVersion !== current) {
    return { error: `list changed: it is at version ${current}, your call is based on ${input.baseVersion} — read it again (get_list) and repeat` }
  }
  // Накопленные правки рабочей копии: версия поверх них сделала бы их устаревшими, и
  // publish_draft потом отказывал бы всегда. Решать, что с ними, — не этому вызову.
  const [pending] = await db
    .select({ id: listDrafts.id })
    .from(listDrafts)
    .where(and(eq(listDrafts.templateId, tpl.id), eq(listDrafts.authorId, userId)))
    .limit(1)
  if (pending) {
    return { error: 'you have pending edits on this list (get_list shows pendingEdits) — publish them with publish_draft or drop them with discard_draft first' }
  }

  // Текущий набор — из дерева текущей версии: слияние без него стёрло бы то, чего агент
  // не назвал. Не ответило ядро — не пишем вслепую.
  const wantsFiles = decoded.files.length > 0 || (input.removeFiles?.length ?? 0) > 0 || input.replaceFiles === true
  let merged: ReturnType<typeof mergeSkillFiles> | null = null
  if (wantsFiles) {
    const have = await gitCore.authoredFiles({ owner: handle, slug }, current).catch(() => null)
    if (!have) return { error: 'could not read the current files of this list from the git core — nothing was written; try again' }
    merged = mergeSkillFiles(have, decoded.files, input.removeFiles ?? [], input.replaceFiles === true)
    if (merged.unknown.length) return { error: `no such files to remove: ${merged.unknown.join(', ')}` }
  }

  // Мета — патчем: title/desc только если их меняют, на языке входа, прочие переводы целы.
  const lang = input.lang === 'ru' || input.lang === 'en' ? input.lang : detectTextLang(`${input.title ?? ''} ${input.desc ?? ''}`)
  const title = input.title?.trim() ? { ...(tpl.title as Record<string, string>), [lang]: input.title.trim() } : undefined
  const desc = input.desc !== undefined ? { ...(tpl.desc as Record<string, string>), [lang]: input.desc.trim() } : undefined

  const filesChanged = merged ? merged.added.length + merged.changed.length + merged.removed.length > 0 : false
  if (!input.items && !filesChanged && !title && !desc && !input.tags && input.ordered === undefined) {
    await markSkill(eq(templates.id, tpl.id))
    if (input.catalog) await assignCatalogByName(tpl.id, userId, input.catalog)
    return { ref: `${handle}/${slug}`, version: current, note: 'Nothing to change — the files and blocks are already like this; no version was made.' }
  }

  // Блоки не пришли — остаются текущие ТОЙ ЖЕ доменной формой (переводы, содержимое).
  let proposed
  if (input.items) {
    proposed = toProposed(input.items)
  } else {
    const detail = await detailByRefOrMoved(handle, slug)
    if (!detail) return { error: 'list not found' }
    proposed = rowsToProposed(detail.steps)
  }
  const res = await writeProposed(
    tpl,
    handle,
    slug,
    proposed,
    input.note?.trim() || 'skill via API',
    {
      tags: input.tags ? normalizeTags(input.tags) : tpl.tags,
      ordered: input.ordered ?? tpl.ordered,
      ...(title ? { title } : {}),
      ...(desc ? { desc } : {}),
    },
    input.baseVersion,
    // Файлы не трогали — поля нет: ядро перенесёт набор родителя как есть.
    merged && filesChanged ? merged.files : undefined,
  )
  if ('error' in res) return res
  await markSkill(eq(templates.id, tpl.id))
  if (merged && filesChanged && res.authoredApplied !== true) return notApplied(`version ${res.version}`)
  const filed = input.catalog ? await assignCatalogByName(tpl.id, userId, input.catalog) : undefined
  const { authoredApplied: _applied, ...rest } = res
  return {
    ...rest,
    ...(parseNotes.length ? { parseNotes } : {}),
    url: `${SITE_URL}/${handle}/${slug}`,
    files: merged ? { added: merged.added, changed: merged.changed, removed: merged.removed, total: merged.files.length } : { unchanged: true },
    catalog: input.catalog ? (filed ? input.catalog : `not found among your catalogs: ${input.catalog}`) : undefined,
    note:
      isPubliclyVisible(tpl)
        ? `Version ${res.version} carries the blocks and files. Install: ${installLine(`${handle}/${slug}`)}`
        : tpl.status === 'draft'
          ? `Version ${res.version} carries the blocks and files; the list is still a draft — publish it with publish_lists to make it installable.`
          : `Version ${res.version} carries the blocks and files; the list is not public (private or under moderation), so agents cannot install it without signing in.`,
  }
}
