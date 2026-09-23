import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
import { tr } from '@/shared/i18n'
import { splitLangPath } from '@/shared/i18n/url'
import { cursorKey, keysetPage, keysetStep } from '@/shared/db/keyset'
import { decodeCursor, LISTS_PER_PAGE } from '@/shared/lib/paging'
import { toExportList, toMarkdown } from '@/features/library/export'
import { versionShaMap } from '@/features/library/version-sha'
import { SITE_URL, detailByRef, mcpCanView } from './shared'
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

const LIST_URI_PREFIX = 'setfork://lists/'
export const LIST_URI_TEMPLATE = `${LIST_URI_PREFIX}{handle}/{slug}`
export const listUri = (handle: string, slug: string) => `${LIST_URI_PREFIX}${handle}/${slug}`

/** Ответ на чужой приватный и на несуществующий — один и тот же: по нему не узнать, что список есть. */
export const LIST_NOT_FOUND = 'List not found or not accessible'

/**
 * Markdown списка по ссылке — или `null`, если его нет или пользователю токена он недоступен.
 *
 * Ссылка — как у остальных инструментов: «handle/slug» или голый «slug», с учётом
 * переезда. Вместе с текстом отдаётся АКТУАЛЬНЫЙ адрес: по нему вызывающий строит `uri`
 * вложения, чтобы агент не держал прежний.
 */
export async function mcpListMarkdown(userId: string, ref: string): Promise<{ text: string; handle: string; slug: string } | null> {
  const detail = await detailByRef(ref)
  if (!detail) return null
  if (!(await mcpCanView(detail.tpl, userId))) return null
  // Подпись версии — как у маршрута экспорта: мягко, отказ ядра не отнимает текст. Номер
  // версии — общим правилом `headVersion`, тем же, которым `get_list` называет его агенту.
  const sha = (await versionShaMap(detail.tpl.id)).get(headVersion(detail.tpl)) ?? null
  const list = toExportList(detail, sha)
  return { text: toMarkdown(list, 'en'), handle: list.ownerHandle, slug: list.slug }
}

/**
 * `resources/list` — СВОИ списки владельца токена, порциями по курсору.
 *
 * Не весь корпус: публичных списков тысячи, а клиент показывает этот перечень человеку как
 * «что можно подключить». Чужой публичный список подключается по адресу напрямую — перечень
 * для этого не нужен.
 *
 * Порядок — по ДАТЕ СОЗДАНИЯ, новые сверху, а не по последней правке. Ключ keyset обязан
 * быть неизменным: список, который правят, пока клиент листает, уехал бы по `updatedAt`
 * выше курсора и не попал бы ни на одну страницу обхода (протокол просит «stable cursors»).
 * Так листают и все остальные ленты проекта.
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
  const step = keysetStep(templates.createdAt, templates.id, cursor)
  const rows = await db
    .select({ id: templates.id, slug: templates.slug, title: templates.title, handle: users.handle, cursorKey: cursorKey(templates.createdAt) })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(and(eq(templates.ownerId, userId), step.where))
    .orderBy(...step.order)
    .limit(LISTS_PER_PAGE + 1)
  const page = keysetPage(rows, LISTS_PER_PAGE, cursor, { reverse: step.reverse })
  return {
    resources: page.shown.map((r) => ({
      uri: listUri(r.handle, r.slug),
      name: `${r.handle}/${r.slug}`,
      title: tr(r.title, 'en') || r.slug,
      mimeType: 'text/markdown',
    })),
    ...(page.next ? { nextCursor: page.next } : {}),
  }
}

/**
 * Ссылка на список из того, что человек или агент передал в сценарий, — в форме общего
 * резолвера (`resolveListRefOrMoved`): `setfork://lists/h/s`, адрес НАШЕГО сайта (языковой
 * префикс снимает общее правило `splitLangPath`) или сама ссылка «handle/slug» / «slug».
 * Разбор ника и слага — дело резолвера, своей копии правила здесь нет. Не разобрали —
 * `null`, и сценарий обходится без вложения: агент найдёт список сам.
 *
 * Хост сверяется: `https://github.com/a/b` — не наш список `a/b`, даже если такой есть.
 * Иначе сценарий разбора чужой ошибки приложил бы агенту посторонний список под видом нужного.
 */
export function listRefFrom(raw: string): string | null {
  const s = raw.trim()
  if (s.startsWith(LIST_URI_PREFIX)) return refOfPath(s.slice(LIST_URI_PREFIX.length))
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    let url: URL
    try {
      url = new URL(s)
    } catch {
      return null
    }
    if (url.host !== new URL(SITE_URL).host) return null
    return refOfPath(splitLangPath(url.pathname).rest)
  }
  return refOfPath(s)
}

/** «handle/slug» или «slug» из пути; больше двух частей — это не адрес списка. */
function refOfPath(path: string): string | null {
  const parts = path.replace(/^\/+|\/+$/g, '').split('/')
  if (parts.length > 2 || parts.some((p) => !p || /\s/.test(p))) return null
  return parts.join('/')
}
