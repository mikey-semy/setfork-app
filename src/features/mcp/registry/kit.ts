import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'

/**
 * Набор регистратора инструментов MCP: ответ, отказ и две обёртки регистрации.
 *
 * Скоуп и подсказки агенту — часть СПОСОБА регистрации, а не забота каждого
 * инструмента. Пока проверка write-скоупа стояла отдельной строкой в теле
 * хендлера, её можно было забыть — и read-токен получал право писать. Здесь
 * забыть нельзя: инструмент регистрируется либо как `readTool`, либо как
 * `writeTool`, третьего входа нет.
 *
 * Аннотации MCP (readOnlyHint/destructiveHint/idempotentHint/openWorldHint)
 * клиент показывает модели и по ним решает, спрашивать ли человека перед
 * вызовом. Проставляются здесь по той же причине: иначе новый инструмент
 * однажды приедет без подсказок, и агент будет гадать, что тот делает.
 * Отдельный инструмент может уточнить свои — например `delete_list`
 * (`destructiveHint`).
 */
export type Extra = { authInfo?: AuthInfo }

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }
export type ToolFn = (userId: string, args: any, extra: Extra) => Promise<ToolResult>

export const json = (data: unknown): ToolResult => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })
export const err = (text: string): ToolResult => ({ content: [{ type: 'text' as const, text }], isError: true })

const READONLY = 'This token is read-only. Use an API token with write scope for this action.'
const userIdOf = (extra: Extra) => extra.authInfo?.extra?.userId as string | undefined
const canWrite = (extra: Extra) => (extra.authInfo?.scopes ?? []).includes('write')

type ToolConfig = { title?: string; description?: string; inputSchema?: unknown; annotations?: Record<string, unknown> }

/** Регистраторы, которые получает каждая тематическая группа инструментов. */
export type ToolKit = {
  readTool: (name: string, config: unknown, fn: ToolFn) => void
  writeTool: (name: string, config: unknown, fn: ToolFn) => void
}

/** Сервер MCP в том виде, в каком он нужен здесь: одна перегруженная регистрация. */
type McpServer = { registerTool: unknown }

export function makeToolKit(server: McpServer): ToolKit {
  // registerTool перегружен (с inputSchema и без) — приводим к одной сигнатуре,
  // чтобы навесить проверку скоупа единообразно. Зод-схема валидирует args в рантайме.
  const register = (server.registerTool as (name: string, config: unknown, cb: (args: any, extra: Extra) => unknown) => void).bind(server)

  const annotate = (config: unknown, base: Record<string, unknown>) => {
    const c = (config ?? {}) as ToolConfig
    return { ...c, annotations: { ...(c.title ? { title: c.title } : {}), ...base, ...(c.annotations ?? {}) } }
  }

  return {
    readTool: (name, config, fn) =>
      register(name, annotate(config, { readOnlyHint: true, idempotentHint: true, openWorldHint: false }), async (args, extra) => {
        const userId = userIdOf(extra)
        if (!userId) return err('Unauthorized')
        return fn(userId, args, extra)
      }),
    writeTool: (name, config, fn) =>
      register(name, annotate(config, { readOnlyHint: false, destructiveHint: false, openWorldHint: false }), async (args, extra) => {
        const userId = userIdOf(extra)
        if (!userId) return err('Unauthorized')
        if (!canWrite(extra)) return err(READONLY)
        return fn(userId, args, extra)
      }),
  }
}
