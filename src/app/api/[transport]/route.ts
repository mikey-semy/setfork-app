import { createHash } from 'node:crypto'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { verifyApiToken } from '@/shared/auth/api-token'
import { clientIp, rateLimit, tooMany } from '@/shared/rate-limit'
import { registerTools, serverOptions } from '@/features/mcp/registry'

/**
 * ТРАНСПОРТ MCP: /api/mcp (Streamable HTTP) и /api/sse (legacy).
 *
 * Здесь только то, как запрос доходит до инструментов: частотный лимит,
 * Bearer-токен → пользователь, монтирование обработчика. Сами инструменты и их
 * описания живут в `features/mcp/registry` — у роута и у реестра разные причины
 * меняться, и раньше они делили один файл на семьсот строк.
 */

const handler = createMcpHandler((server) => registerTools(server), serverOptions, {
  basePath: '/api', // → эндпоинт /api/mcp (Streamable HTTP), /api/sse (legacy)
})

// Bearer-токен SetFork → пользователь.
const verifyToken = async (_req: Request, bearer?: string): Promise<AuthInfo | undefined> => {
  const auth = await verifyApiToken(bearer)
  if (!auth) return undefined
  const scopes = auth.scope === 'read' ? ['read'] : ['read', 'write']
  return { token: bearer as string, scopes, clientId: auth.userId, extra: { userId: auth.userId } }
}

const authHandler = withMcpAuth(handler, verifyToken, { required: true })

// HTTP-рейтлимит перед авторизацией/диспатчем: у git-роута такой есть, у MCP не было —
// один токен = один клиент, ключ по SHA-256 токена (сам токен в памяти не держим),
// иначе по IP. Кап на минуту (SETFORK_MCP_RATE_PER_MIN, дефолт 120 — щедро для агента,
// но режет абуз). In-memory, как остальные лимитеры (мульти-инстанс → Redis).
const MCP_RATE_PER_MIN = Number(process.env.SETFORK_MCP_RATE_PER_MIN ?? 120)

async function rateLimited(req: Request): Promise<Response> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? ''
  const key = bearer
    ? `mcp:tok:${createHash('sha256').update(bearer).digest('hex').slice(0, 16)}`
    : `mcp:ip:${clientIp(req)}`
  const r = await rateLimit(key, MCP_RATE_PER_MIN, 60_000)
  if (!r.ok) return tooMany(r)
  return authHandler(req)
}

export { rateLimited as GET, rateLimited as POST }
