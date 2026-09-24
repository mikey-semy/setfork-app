// Публикация скилла через MCP: блоки списка и файлы автора — ОДНОЙ версией.
// Причина измениться у модуля одна — как агент приносит скилл целиком (ADR-0028).
//
// Раньше скилл собирался в два приёма: текст — `create_list`/`patch_list`, файлы —
// только `git push`. Между ними жила версия без файлов, и её успевали поставить. Здесь
// оба приезжают одним коммитом: новый список рождается сразу с файлами, у существующего
// набор заменяется той же версией, что и блоки.
//
// Правил своих нет: владение, архив, сверка версии, страж исполняемого — в общих путях
// `create`/`write`; правило дерева (каталоги, текст, число, размер) судит ядро, тем же
// кодом, что на push. Здесь — только разбор входа и дружелюбный ранний отказ.

import 'server-only'
import type { AuthoredFile } from '@/core'
import { AUTHORED_PATH } from '@/features/library/skill'
import { detailByRefOrMoved, toProposed, type McpItemInput } from '../shared'
import { mcpCreateList } from './create'
import { rowsToProposed } from './patch-block'
import { headVersion, staleBase } from './base-version'
import { authoredError, destructiveError, ownedList, writeProposed } from './write'

export interface McpSkillFileInput {
  path: string
  content: string
  /** 'utf8' (по умолчанию) — текст как есть; 'base64' — точные байты. */
  encoding?: 'utf8' | 'base64'
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
  /** Блоки. У существующего списка не заданы — остаются текущие, меняются только файлы. */
  items?: McpItemInput[]
  /** ПОЛНЫЙ набор файлов автора: заменяет прежний целиком, `[]` убирает все. */
  files: McpSkillFileInput[]
  note?: string
}

/** Вход → байты с ранним отказом. Число и размер не проверяем: их судит ядро, а вторая
 *  копия пределов здесь однажды разошлась бы с его константами. */
export function decodeSkillFiles(files: McpSkillFileInput[]): { files: AuthoredFile[] } | { error: string } {
  const seen = new Set<string>()
  const out: AuthoredFile[] = []
  for (const f of files) {
    const path = (f.path ?? '').trim()
    if (!AUTHORED_PATH.test(path) || path.split('/').includes('..')) {
      return { error: `bad file path "${path}": files live directly in scripts/, references/ or assets/ — one level, no subfolders` }
    }
    if (seen.has(path)) return { error: `the file "${path}" is listed twice` }
    seen.add(path)
    const content = f.encoding === 'base64' ? new Uint8Array(Buffer.from(f.content ?? '', 'base64')) : new TextEncoder().encode(f.content ?? '')
    // Двоичное дерево скилла не примет (ни с сайта, ни пушем): признак тот же, что у git.
    if (content.includes(0)) return { error: `"${path}" is a binary file — a skill keeps text only` }
    out.push({ path, content, executable: f.executable === true })
  }
  return { files: out }
}

/** ОПУБЛИКОВАТЬ СКИЛЛ: блоки + файлы автора одной версией. */
export async function mcpPublishSkill(userId: string, input: McpPublishSkillInput) {
  const decoded = decodeSkillFiles(input.files ?? [])
  if ('error' in decoded) return decoded
  const authored = decoded.files
  const files = authored.map((f) => f.path)

  if (!input.list) {
    if (!input.title?.trim()) return { error: 'title is required for a new skill (or pass list to update an existing one)' }
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
      return {
        ...res,
        version: 1,
        files,
        note: 'Created as a private draft with its files in version 1. Publish it (publish_lists) and make it public to let agents install it: npx skills add <site>/<ref>/skill.tar.gz',
      }
    } catch (e) {
      const refused = destructiveError(e) ?? authoredError(e)
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
  if (input.baseVersion !== current) return staleBase(current, input.baseVersion, 'replacement')

  // Блоки не пришли — остаются текущие ТОЙ ЖЕ доменной формой (переводы, содержимое),
  // меняются только файлы. Через плоскую форму MCP они потеряли бы переводы.
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
    input.note?.trim() || 'skill files via API',
    {
      tags: input.tags ? input.tags.map((t) => t.toLowerCase().replace(/[^a-z0-9а-яё-]/gi, '')).filter(Boolean).slice(0, 8) : tpl.tags,
      ordered: input.ordered ?? tpl.ordered,
    },
    input.baseVersion,
    authored,
  )
  if ('error' in res) return res
  return { ...res, files, note: `Version ${res.version} carries the blocks and exactly these files — the previous file set was replaced.` }
}
