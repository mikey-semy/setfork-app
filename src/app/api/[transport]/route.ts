import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { z } from 'zod'
import { verifyApiToken } from '@/shared/auth/api-token'
import { mcpCheckStep, mcpCreateList, mcpGetList, mcpGetRun, mcpSearch, mcpStartRun, mcpUpdateList } from '@/features/mcp/tools'

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })
const err = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'search_lists',
      {
        title: 'Search checklists',
        description: 'Search public SetFork checklists (and your own private ones) by keywords/meaning. Returns list refs "owner/slug".',
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

    const itemShape = z.object({
      title: z.string().describe('Step title (short imperative)'),
      desc: z.string().optional().describe('One or two clarifying sentences (light markdown ok)'),
      command: z.string().optional().describe('Shell command, if any'),
      level: z.enum(['required', 'recommended', 'optional']).optional().describe('How essential the step is'),
      why: z.string().optional().describe('Why this step matters (rationale)'),
      section: z.string().optional().describe('Optional section header; consecutive steps sharing it are grouped under it'),
      subtasks: z.array(z.string()).optional().describe('Verification checks'),
    })

    server.registerTool(
      'create_list',
      {
        title: 'Create a checklist',
        description: 'Create a new checklist owned by you. It is created as a PRIVATE DRAFT — you publish it later on the site.',
        inputSchema: {
          title: z.string().describe('List title'),
          desc: z.string().optional().describe('One-line description'),
          tags: z.array(z.string()).optional().describe('3-6 short tags'),
          ordered: z.boolean().optional().describe('true = ordered steps, false = unordered set (default true)'),
          items: z.array(itemShape).min(1).describe('The steps'),
        },
      },
      async (args, extra) => {
        const userId = extra.authInfo?.extra?.userId as string | undefined
        if (!userId) return err('Unauthorized')
        const res = await mcpCreateList(userId, args)
        return 'error' in res ? err(res.error as string) : json(res)
      },
    )

    server.registerTool(
      'update_list',
      {
        title: 'Update a checklist',
        description: 'Replace the steps of a checklist you own. A draft is edited in place; a published list gets a new version.',
        inputSchema: {
          handle: z.string().describe('Owner handle (must be you)'),
          slug: z.string().describe('List slug'),
          items: z.array(itemShape).min(1).describe('The new full set of steps'),
          note: z.string().optional().describe('Change note (for published lists)'),
          tags: z.array(z.string()).optional(),
          ordered: z.boolean().optional(),
        },
      },
      async ({ handle, slug, ...rest }, extra) => {
        const userId = extra.authInfo?.extra?.userId as string | undefined
        if (!userId) return err('Unauthorized')
        const res = await mcpUpdateList(userId, handle, slug, rest)
        return 'error' in res ? err(res.error as string) : json(res)
      },
    )

    server.registerTool(
      'start_run',
      {
        title: 'Start a run',
        description: 'Start (or resume your active) run of a checklist by ref — a personal pass to track progress. Returns the run id, steps and progress.',
        inputSchema: {
          handle: z.string().describe('Owner handle'),
          slug: z.string().describe('List slug'),
        },
      },
      async ({ handle, slug }, extra) => {
        const userId = extra.authInfo?.extra?.userId as string | undefined
        if (!userId) return err('Unauthorized')
        const res = await mcpStartRun(userId, handle, slug)
        return 'error' in res ? err(res.error as string) : json(res)
      },
    )

    server.registerTool(
      'get_run',
      {
        title: 'Get run progress',
        description: 'Fetch a run by its id: steps with done/not-done and overall progress.',
        inputSchema: { runId: z.string().describe('The run id from start_run') },
      },
      async ({ runId }, extra) => {
        const userId = extra.authInfo?.extra?.userId as string | undefined
        if (!userId) return err('Unauthorized')
        const res = await mcpGetRun(userId, runId)
        return 'error' in res ? err(res.error as string) : json(res)
      },
    )

    server.registerTool(
      'check_step',
      {
        title: 'Check off a run step',
        description: 'Mark a step of your run done or not-done by its number. Omit "done" to toggle. Returns the updated run.',
        inputSchema: {
          runId: z.string().describe('The run id'),
          step: z.number().int().min(1).describe('Step number (1-based)'),
          done: z.boolean().optional().describe('true = done, false = not done; omit to toggle'),
        },
      },
      async ({ runId, step, done }, extra) => {
        const userId = extra.authInfo?.extra?.userId as string | undefined
        if (!userId) return err('Unauthorized')
        const res = await mcpCheckStep(userId, runId, step, done)
        return 'error' in res ? err(res.error as string) : json(res)
      },
    )
  },
  { serverInfo: { name: 'setfork', version: '0.1.0' }, capabilities: { tools: {} } },
  { basePath: '/api' }, // → эндпоинт /api/mcp (Streamable HTTP), /api/sse (legacy)
)

// Bearer-токен SetFork → пользователь.
const verifyToken = async (_req: Request, bearer?: string): Promise<AuthInfo | undefined> => {
  const auth = await verifyApiToken(bearer)
  if (!auth) return undefined
  const scopes = auth.scope === 'read' ? ['read'] : ['read', 'write']
  return { token: bearer as string, scopes, clientId: auth.userId, extra: { userId: auth.userId } }
}

const authHandler = withMcpAuth(handler, verifyToken, { required: true })

export { authHandler as GET, authHandler as POST }
