import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ErrorCode, ListResourcesRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import { LIST_NOT_FOUND, LIST_URI_TEMPLATE, mcpListMarkdown, mcpOwnListResources } from '../tools/resources'
import { userIdOf, type Extra, type McpServer } from './kit'

/**
 * РЕСУРСЫ MCP: список по адресу `setfork://lists/{handle}/{slug}`.
 *
 * Правила доступа и языка — те же, что у `get_list` (см. `tools/resources`). Подписок нет
 * вовсе: SDK 1.30 знает редакцию протокола 2025-11-25, а в 2026-07-28 подписки переделаны
 * (единый поток `subscriptions/listen` вместо `resources/subscribe`). Строить на механизме,
 * который уже заменён, незачем.
 */

/**
 * Переменная шаблона. Битое процент-кодирование (`%E0`) — ошибка параметров, а не сбой
 * сервера. Косая черта ВНУТРИ части (`%2F`) — тоже: иначе `h/a%2Fb` превратился бы в
 * ссылку «h/a/b», резолвер взял бы из неё первые две части, и один список отвечал бы
 * по чужому адресу.
 */
function one(v: string | string[]): string {
  let out: string
  try {
    out = decodeURIComponent(Array.isArray(v) ? (v[0] ?? '') : v)
  } catch {
    throw new McpError(ErrorCode.InvalidParams, 'Malformed list address')
  }
  if (!out || out.includes('/')) throw new McpError(ErrorCode.InvalidParams, 'Malformed list address')
  return out
}

export function registerResources(server: McpServer) {
  server.registerResource(
    'list',
    // `list: undefined` намеренно: перечень отдаёт свой обработчик ниже — с курсором.
    new ResourceTemplate(LIST_URI_TEMPLATE, { list: undefined }),
    {
      title: 'SetFork list',
      description:
        'A list as markdown — the same text as its Markdown export: steps with commands, danger marks and links, text blocks in order. Quizzes and files are left out and block ids (bid) are not included: to edit or review a list, use get_list.',
      mimeType: 'text/markdown',
    },
    async (uri, vars, extra) => {
      const userId = userIdOf(extra as Extra)
      if (!userId) throw new McpError(ErrorCode.InvalidRequest, 'Unauthorized')
      const found = await mcpListMarkdown(userId, `${one(vars.handle)}/${one(vars.slug)}`)
      // Чужой приватный и несуществующий — одним и тем же ответом.
      if (!found) throw new McpError(ErrorCode.InvalidParams, LIST_NOT_FOUND)
      // `uri` — тот, что спросили (так велит протокол), даже у переехавшего списка:
      // актуальный адрес агент видит в шапке текста.
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: found.text }] }
    },
  )

  // ⚠️ SDK при первой регистрации ресурса САМ объявляет `resources.listChanged: true` — то
  // есть обещает клиенту уведомления об изменении перечня, которых не будет. Возможности
  // сливаются поверх, поэтому явное `false` здесь это обещание снимает.
  server.server.registerCapabilities({ resources: { listChanged: false } })

  // ⚠️ `resources/list` — СВОИМ обработчиком, а не колбэком шаблона: высокоуровневый
  // `McpServer` курсор в колбэк не передаёт и `nextCursor` не возвращает, то есть отдаёт
  // перечень целиком. Здесь — свои списки владельца токена, порциями по курсору.
  // ⚠️ Обработчик заменяет перечень SDK ЦЕЛИКОМ: ресурс с фиксированным адресом, заведённый
  // позже через `registerResource`, в перечень сам не попадёт — его надо добавить сюда.
  server.server.setRequestHandler(ListResourcesRequestSchema, async (req, extra) => {
    const userId = userIdOf(extra as Extra)
    if (!userId) throw new McpError(ErrorCode.InvalidRequest, 'Unauthorized')
    const page = await mcpOwnListResources(userId, req.params?.cursor)
    // Протокол: неразобранный курсор — ошибка -32602, а не первая страница заново.
    if (!page) throw new McpError(ErrorCode.InvalidParams, 'Invalid cursor')
    return page
  })
}
