import { z } from 'zod'
import { mcpListSources, mcpRegisterSource } from '@/features/mcp/tools'
import { err, json, type ToolKit } from './kit'

/** Источники обновлений: регистрация и список. */
export function registerSourceTools({ readTool, writeTool }: ToolKit) {
  // Регистрация источника — единственная дверь, через которую чужой материал попадает в
  // корпус. Лицензию называет ЧЕЛОВЕК: доступность страницы не означает права копировать.
  writeTool(
    'register_source',
    {
      title: 'Register an external source',
      description:
        'Register an external source the company is allowed to draw on. ADMIN ONLY: the license verdict is a legal decision, not a routine write. The license is FAIL-CLOSED: only CC0, public domain, CC-BY, CC-BY-SA, MIT and Apache-2.0 are accepted, and licenses requiring attribution are rejected until you provide it. NC/ND variants are refused. Re-registering the same URL updates the record instead of creating a second one.',
      inputSchema: {
        url: z.string().describe('Source URL (http/https)'),
        license: z.string().describe('License as stated by the source, e.g. "CC BY 4.0", "CC0 1.0", "MIT"'),
        title: z.string().optional().describe('Human-readable title'),
        attribution: z.string().optional().describe('Whom to credit — required by CC-BY/CC-BY-SA/MIT/Apache'),
        note: z.string().optional().describe('What exactly is taken and why'),
      },
    },
    async (userId, args) => {
      const res = await mcpRegisterSource(userId, args)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  readTool(
    'list_sources',
    {
      title: 'Registered sources',
      description: 'List sources registered as allowed to draw on, with their licenses and attribution.',
      inputSchema: { limit: z.number().int().min(1).max(200).optional().describe('Max results (default 50)') },
    },
    async (_userId, { limit }) => json(await mcpListSources(limit ?? 50)),
  )
}
