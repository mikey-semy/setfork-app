import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { z } from 'zod'
import { verifyApiToken } from '@/shared/auth/api-token'
import { mcpGetList, mcpSearch } from '@/features/mcp/tools'

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })
const err = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'search_lists',
      {
        title: 'Search checklists',
        description: 'Search public SetHub checklists (and your own private ones) by keywords/meaning. Returns list refs "owner/slug".',
        inputSchema: {
          query: z.string().describe('Search terms — topic, tool or task'),
          limit: z.number().int().min(1).max(50).optional().describe('Max results (default 10)'),
        },
      },
      async ({ query, limit }, extra) => {
        const userId = extra.authInfo?.extra?.userId as string | undefined
        if (!userId) return err('Unauthorized')
        return json(await mcpSearch(userId, query, limit ?? 10))
      },
    )

    server.registerTool(
      'get_list',
      {
        title: 'Get a checklist',
        description: 'Fetch a full checklist (steps, commands, subtasks, links) by its ref: owner handle + slug.',
        inputSchema: {
          handle: z.string().describe('Owner handle, e.g. "acme"'),
          slug: z.string().describe('List slug, e.g. "deploy-to-vps"'),
        },
      },
      async ({ handle, slug }, extra) => {
        const userId = extra.authInfo?.extra?.userId as string | undefined
        if (!userId) return err('Unauthorized')
        const list = await mcpGetList(userId, handle, slug)
        return list ? json(list) : err('List not found or not accessible')
      },
    )
  },
  { serverInfo: { name: 'sethub', version: '0.1.0' }, capabilities: { tools: {} } },
  { basePath: '/api' }, // → эндпоинт /api/mcp (Streamable HTTP), /api/sse (legacy)
)

// Bearer-токен SetHub → пользователь.
const verifyToken = async (_req: Request, bearer?: string): Promise<AuthInfo | undefined> => {
  const userId = await verifyApiToken(bearer)
  if (!userId) return undefined
  return { token: bearer as string, scopes: ['read'], clientId: userId, extra: { userId } }
}

const authHandler = withMcpAuth(handler, verifyToken, { required: true })

export { authHandler as GET, authHandler as POST }
