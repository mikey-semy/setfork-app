import { describe, expect, it } from 'vitest'
import { registerAllTools } from '@/features/mcp/registry'

/**
 * Состав набора MCP и вшитая в регистрацию проверка доступа.
 *
 * Инструменты объявлены семью тематическими модулями, и регистратор у них один
 * (`registerAllTools`). Без этого теста забытый вызов терял бы часть набора
 * молча: клиент просто не увидел бы инструментов, а ни типы, ни сборка такого
 * не ловят.
 *
 * Второе, что здесь проверяется, — что write-инструмент отказывает токену без
 * write-скоупа. Проверка живёт в способе регистрации (`writeTool`), и её
 * поломка означала бы, что read-токен получил право писать.
 */

type Registered = { name: string; config: { annotations?: Record<string, unknown> }; cb: (args: unknown, extra: unknown) => Promise<{ isError?: boolean; content: { text: string }[] }> }

function collect(): Map<string, Registered> {
  const out = new Map<string, Registered>()
  registerAllTools({
    registerTool: (name: string, config: Registered['config'], cb: Registered['cb']) => {
      out.set(name, { name, config, cb })
    },
  } as unknown as { registerTool: unknown })
  return out
}

// Набор перечислен полностью и намеренно: тест обязан падать и когда инструмент
// пропал, и когда появился незаявленный.
const EXPECTED = [
  'apply_suggestion', 'ask_gnome', 'bulk_create_lists', 'check_step', 'council_draft', 'create_list',
  'delete_list', 'discard_draft', 'get_council_draft', 'get_list', 'get_run', 'get_script',
  'gnome_review', 'list_gnomes', 'list_sources', 'merge_suggestion', 'patch_list',
  'pending_suggestions', 'publish_draft', 'register_source', 'report_check', 'review_suggestion',
  'revert_suggestion', 'search_lists', 'start_run', 'suggest_edit', 'update_list',
]

const READ_ONLY = ['search_lists', 'get_list', 'get_script', 'get_run', 'list_gnomes', 'ask_gnome', 'gnome_review', 'get_council_draft', 'pending_suggestions', 'list_sources']

describe('набор инструментов MCP', () => {
  it('регистрируется целиком и без лишнего', () => {
    expect([...collect().keys()].sort()).toEqual([...EXPECTED].sort())
  })

  it('каждый инструмент несёт подсказки агенту', () => {
    for (const [name, t] of collect()) {
      expect(t.config.annotations, `${name} без annotations`).toBeDefined()
      expect(t.config.annotations).toHaveProperty('openWorldHint')
    }
  })

  it('читающие помечены readOnlyHint, пишущие — нет', () => {
    for (const [name, t] of collect()) {
      expect(t.config.annotations?.readOnlyHint, name).toBe(READ_ONLY.includes(name))
    }
  })

  it('без токена не работает ни один инструмент', async () => {
    for (const [name, t] of collect()) {
      const res = await t.cb({}, {})
      expect(res.isError, name).toBe(true)
      expect(res.content[0]?.text, name).toBe('Unauthorized')
    }
  })

  it('пишущий инструмент отказывает токену только на чтение', async () => {
    const readToken = { authInfo: { extra: { userId: 'u1' }, scopes: ['read'] } }
    for (const [name, t] of collect()) {
      if (READ_ONLY.includes(name)) continue
      const res = await t.cb({}, readToken)
      expect(res.isError, name).toBe(true)
      expect(res.content[0]?.text, name).toContain('read-only')
    }
  })
})
