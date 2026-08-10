import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { createMcpHandler } from 'mcp-handler'

/**
 * СПОСОБ РЕГИСТРАЦИИ инструмента MCP — одна причина менять этот файл.
 *
 * Скоуп и подсказки агенту вшиты сюда, а не расставлены по инструментам: `readTool`
 * требует только userId, `writeTool` — ещё и write-scope. Раньше проверка была
 * отдельной строкой в каждом хендлере, и её легко было забыть — read-токен писал.
 * По той же причине здесь же проставляются аннотации MCP: иначе новый инструмент
 * однажды приедет без подсказок, и агент будет гадать, что тот делает.
 */

export const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })
export const err = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })

export type Extra = { authInfo?: AuthInfo }
export const userIdOf = (extra: Extra) => extra.authInfo?.extra?.userId as string | undefined
export const canWrite = (extra: Extra) => (extra.authInfo?.scopes ?? []).includes('write')
export const READONLY = 'This token is read-only. Use an API token with write scope for this action.'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- args валидирует зод-схема инструмента в рантайме
export type ToolFn = (userId: string, args: any, extra: Extra) => Promise<ReturnType<typeof json> | ReturnType<typeof err>>
type Register = (name: string, config: unknown, fn: ToolFn) => void

/** Сервер MCP, каким его отдаёт `createMcpHandler` своему колбэку. */
type McpServer = Parameters<Parameters<typeof createMcpHandler>[0]>[0]

/** Пара регистраторов, которую получает каждый модуль домена. */
export interface ToolKit {
  readTool: Register
  writeTool: Register
}

type ToolConfig = { title?: string; description?: string; inputSchema?: unknown; annotations?: Record<string, unknown> }

/** Отдельный инструмент может уточнить свои подсказки (например `delete_list` — destructiveHint). */
const annotate = (config: unknown, base: Record<string, unknown>) => {
  const c = (config ?? {}) as ToolConfig
  return { ...c, annotations: { ...(c.title ? { title: c.title } : {}), ...base, ...(c.annotations ?? {}) } }
}

export function toolKit(server: McpServer): ToolKit {
  // registerTool перегружен (с/без inputSchema) — оборачиваем через приведённую сигнатуру,
  // чтобы навесить проверку scope единообразно. Зод-схема валидирует args в рантайме.
  const register = server.registerTool.bind(server) as unknown as (
    name: string,
    config: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- см. ToolFn
    cb: (args: any, extra: Extra) => unknown,
  ) => void

  const readTool: Register = (name, config, fn) =>
    register(name, annotate(config, { readOnlyHint: true, idempotentHint: true, openWorldHint: false }), async (args, extra) => {
      const userId = userIdOf(extra)
      if (!userId) return err('Unauthorized')
      return fn(userId, args, extra)
    })

  const writeTool: Register = (name, config, fn) =>
    register(name, annotate(config, { readOnlyHint: false, destructiveHint: false, openWorldHint: false }), async (args, extra) => {
      const userId = userIdOf(extra)
      if (!userId) return err('Unauthorized')
      if (!canWrite(extra)) return err(READONLY)
      return fn(userId, args, extra)
    })

  return { readTool, writeTool }
}
