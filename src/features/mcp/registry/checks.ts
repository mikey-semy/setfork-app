import { z } from 'zod'
import { mcpReportCheck } from '@/features/mcp/tools'
import { err, json, type ToolKit } from './kit'

/** Отчёты внешних проверок — наша сторона интеграций. */
export function registerChecks({ readTool, writeTool }: ToolKit) {
  // Отчёт внешней проверки: наша сторона интеграций. Прогонов чужого кода у нас
  // нет, зато они есть у агента снаружи — пусть присылает итог сюда, к предложению.
  writeTool(
    'report_check',
    {
      title: 'Report an external check on a suggestion',
      description:
        'Report the result of an external check (tests, lint, build…) on an open suggestion, like a CI status check. The check appears on the Checks tab of that suggestion. Reporting the same name again UPDATES the previous result, so a long run can report "pending" first and the real outcome later. Only the list owner or a collaborator may report — not the suggestion author.',
      inputSchema: {
        list: z.string().describe('List reference: "handle/slug" or just "slug"'),
        number: z.number().int().min(1).describe('Suggestion number within the list, e.g. 12'),
        name: z.string().describe('Check name — also the update key, e.g. "tests"'),
        status: z.enum(['ok', 'warn', 'fail', 'neutral', 'pending']).describe('Outcome; "pending" means still running'),
        summary: z.string().optional().describe('One line of detail, e.g. "3 of 120 failed"'),
        url: z.string().optional().describe('http(s) link to the full log'),
      },
    },
    async (userId, args) => {
      const res = await mcpReportCheck(userId, args)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )
}
