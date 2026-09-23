import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
import { tr } from '@/shared/i18n'
import { cursorKey, keysetPage, keysetStep } from '@/shared/db/keyset'
import { decodeCursor, LISTS_PER_PAGE } from '@/shared/lib/paging'
import { toExportList, toMarkdown } from '@/features/library/export'
import { versionShaMap } from '@/features/library/version-sha'
import { SITE_URL, detailByRefOrMoved, mcpCanView } from './shared'
import { headVersion } from './lists/base-version'

/**
 * СПИСОК КАК РЕСУРС MCP: `setfork://lists/{handle}/{slug}` → markdown.
 *
 * Агент подключает список контекстом, не вызывая инструмент. Правила — ровно те же, что у
 * `get_list`, и не своей копией: поиск по адресу с учётом переезда (`detailByRefOrMoved`),
 * доступ пользователя токена (`mcpCanView`), язык — английский, как у `get_list`. Текст — тот
 * же, что у Markdown-экспорта (`toMarkdown`), чтобы «список по адресу» и «список файлом»
 * не могли разойтись.
 */

export const LIST_URI_TEMPLATE = 'setfork://lists/{handle}/{slug}'
export const listUri = (handle: string, slug: string) => `setfork://lists/${handle}/${slug}`

/** Ответ на чужой приватный и на несуществующий — один и тот же: по нему не узнать, что список есть. */
export const LIST_NOT_FOUND = 'List not found or not accessible'

/** Markdown списка — или `null`, если его нет или пользователю токена он недоступен. */
export async function mcpListMarkdown(userId: string, handle: string, slug: string): Promise<string | null> {
  const detail = await detailByRefOrMoved(handle, slug)
  if (!detail) return null
  if (!(await mcpCanView(detail.tpl, userId))) return null
  // Подпись версии — как у маршрута экспорта: мягко, отказ ядра не отнимает текст. Номер
  // версии — общим правилом `headVersion`, тем же, которым `get_list` называет его агенту.
  const sha = (await versionShaMap(detail.tpl.id)).get(headVersion(detail.tpl)) ?? null
  return toMarkdown(toExportList(detail, sha), 'en')
}

/**
 * `resources/list` — СВОИ списки владельца токена, порциями по курсору.
 *
 * Не весь корпус: публичных списков тысячи, а клиент показывает этот перечень человеку как
 * «что можно подключить». Чужой публичный список подключается по адресу напрямую — перечень
 * для этого не нужен. Порядок — свежие правки сверху, листание — общим keyset проекта.
 *
 * `null` — курсор прислан, но не разобран. Молча начать с первой страницы нельзя: клиент
 * склеил бы её с уже полученными и показал бы списки дважды. Протокол велит ответить
 * ошибкой -32602 — это делает регистратор.
 */
export async function mcpOwnListResources(
  userId: string,
  rawCursor?: string,
): Promise<{ resources: { uri: string; name: string; title: string; mimeType: string }[]; nextCursor?: string } | null> {
  const cursor = decodeCursor(rawCursor)
  if (rawCursor !== undefined && !cursor) return null
  const step = keysetStep(templates.updatedAt, templates.id, cursor)
  const rows = await db
    .select({ id: templates.id, slug: templates.slug, title: templates.title, cursorKey: cursorKey(templates.updatedAt) })
    .from(templates)
    .where(and(eq(templates.ownerId, userId), step.where))
    .orderBy(...step.order)
    .limit(LISTS_PER_PAGE + 1)
  const page = keysetPage(rows, LISTS_PER_PAGE, cursor, { reverse: step.reverse })
  const [owner] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1)
  if (!owner) return { resources: [] }
  return {
    resources: page.shown.map((r) => ({
      uri: listUri(owner.handle, r.slug),
      name: `${owner.handle}/${r.slug}`,
      title: tr(r.title, 'en') || r.slug,
      mimeType: 'text/markdown',
    })),
    ...(page.next ? { nextCursor: page.next } : {}),
  }
}

/**
 * Адрес списка из того, что человек или агент передал в сценарий: `handle/slug`, адрес
 * НАШЕГО сайта (с языковым префиксом или без) или `setfork://lists/…`. Не разобрали — `null`,
 * и сценарий обходится без приложенного ресурса: агент найдёт список сам.
 *
 * Хост сверяется: `https://github.com/a/b` — не наш список `a/b`, даже если такой есть.
 * Иначе сценарий разбора чужой ошибки приложил бы агенту посторонний список под видом нужного.
 */
export function parseListRef(raw: string): { handle: string; slug: string } | null {
  const s = raw.trim()
  const m = /^setfork:\/\/lists\/([^/\s]+)\/([^/\s?#]+)$/.exec(s) ?? /^\/?([a-z0-9-]{3,30})\/([^/\s?#]+)$/.exec(s)
  if (m) return { handle: m[1], slug: m[2] }
  let url: URL
  try {
    url = new URL(s)
  } catch {
    return null
  }
  if (url.host !== new URL(SITE_URL).host) return null
  const path = /^\/(?:(?:ru|en)\/)?([^/]+)\/([^/]+)\/?$/.exec(url.pathname)
  return path ? { handle: path[1], slug: path[2] } : null
}
