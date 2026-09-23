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

const one = (v: string | string[]) => decodeURIComponent(Array.isArray(v) ? (v[0] ?? '') : v)

export function registerResources(server: McpServer) {
  server.registerResource(
    'list',
    // `list: undefined` намеренно: перечень отдаёт свой обработчик ниже — с курсором.
    new ResourceTemplate(LIST_URI_TEMPLATE, { list: undefined }),
    {
      title: 'SetFork list',
      description:
        'A list as markdown — the same text as its Markdown export: every block in order, steps with commands and links. Attach it as context instead of calling get_list.',
      mimeType: 'text/markdown',
    },
    async (uri, vars, extra) => {
      const userId = userIdOf(extra as Extra)
      if (!userId) throw new McpError(ErrorCode.InvalidRequest, 'Unauthorized')
      const text = await mcpListMarkdown(userId, one(vars.handle), one(vars.slug))
      // Чужой приватный и несуществующий — одним и тем же ответом.
      if (text === null) throw new McpError(ErrorCode.InvalidParams, LIST_NOT_FOUND)
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] }
    },
  )

  // ⚠️ SDK при первой регистрации ресурса САМ объявляет `resources.listChanged: true` — то
  // есть обещает клиенту уведомления об изменении перечня, которых не будет. Возможности
  // сливаются поверх, поэтому явное `false` здесь это обещание снимает.
  server.server.registerCapabilities({ resources: { listChanged: false } })

  // ⚠️ `resources/list` — СВОИМ обработчиком, а не колбэком шаблона: высокоуровневый
  // `McpServer` курсор в колбэк не передаёт и `nextCursor` не возвращает, то есть отдаёт
  // перечень целиком. Здесь — свои списки владельца токена, порциями по курсору.
  server.server.setRequestHandler(ListResourcesRequestSchema, async (req, extra) => {
    const userId = userIdOf(extra as Extra)
    if (!userId) throw new McpError(ErrorCode.InvalidRequest, 'Unauthorized')
    return mcpOwnListResources(userId, req.params?.cursor)
  })
}
