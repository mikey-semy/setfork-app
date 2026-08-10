import { createHash } from 'node:crypto'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { APP_VERSION } from '@/shared/app-version'
import { getBuildId } from '@/shared/version'
import { verifyApiToken } from '@/shared/auth/api-token'
import { clientIp, rateLimit, tooMany } from '@/shared/rate-limit'
import { registerAllTools } from '@/features/mcp/registry'

// HTTP-граница MCP: аутентификация по Bearer-токену, рейт-лимит и сборка сервера.
// САМИ инструменты (27 штук с их описаниями и схемами) живут в
// features/mcp/registry/* по темам: здесь была бы стена в 600 строк, где правка
// описания одного инструмента соседствует с проверкой токена.
const handler = createMcpHandler(
  (server) => registerAllTools(server),
  {
    // Версия = семантическая + идентификатор сборки: семантическая меняется редко, а
    // инструменты приезжают с каждой выкаткой — по хвосту видно, ту ли схему держит клиент.
    serverInfo: { name: 'setfork', version: `${APP_VERSION}+${getBuildId()}` },
    // listChanged заявляем честно: набор инструментов меняется с выкаткой, и клиент
    // должен знать, что список стоит перечитывать, а не держать вечно. Версия сервера
    // берётся из сборки, а не из строки в коде: по ней видно, свежую ли схему держит
    // клиент (жалоба владельца 04.08.2026: клиент отдавал схему без refs).
    capabilities: { tools: { listChanged: true } },
    // instructions агент получает при подключении — это его карта сервера. Без неё он
    // угадывает порядок работы и, например, шлёт список целиком там, где хватило бы
    // точечной правки.
    instructions: [
      'SetFork keeps runnable, versioned checklists ("lists"). A list is a sequence of blocks: step, text, image, poll, video, quiz, file.',
      '',
      'Working loop:',
      '1. Find it: search_lists, then get_list — it returns every block with a stable "bid" and the list "version".',
      '2. Change it: patch_list. Address blocks by "bid", send ONLY the fields you change, pass baseVersion = the "version" from get_list. Ops: update, insert, delete, move.',
      '   Use update_list only to replace the whole set of blocks — anything omitted there is removed.',
      '3. Batch: by default one patch_list call = one new version. To let several rounds of edits land as ONE version, call patch_list with publish:false — they pile up in a draft (get_list shows it as pendingEdits) — and finish with publish_draft (two-step: it reports first, publishes with confirm:true). Stuck because the list moved on? discard_draft throws the pile away.',
      '',
      'Good to know:',
      '- A list that was never published is edited in place; for a published list every write call makes a version unless you pass publish:false.',
      '- baseVersion protects you: if someone edited the list meanwhile, the patch is rejected instead of overwriting their work — re-read with get_list and retry.',
      '- Step links are just {"url": "..."}; a label is optional and the interface falls back to the domain.',
      '- delete_list is irreversible and needs confirm:true; without it the call only reports what would go.',
      '- Write tools need a token with write scope; read tools work with any token.',
    ].join('\n'),
  },
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
