import { z } from 'zod'
import { mcpAddIssueComment, mcpCloseIssue, mcpCreateIssue, mcpGetIssue, mcpReopenIssue, mcpSearchIssues } from '@/features/mcp/tools'
import { json, err, type ToolKit } from './kit'

/**
 * Задачи: завести, прочитать с лентой, ответить, закрыть с исходом, переоткрыть, найти.
 *
 * Раздел «Вопросы» был доступен только из браузера, хотя именно он — место, где агенту
 * есть что сказать: он читает список, находит в нём ошибку и до сих пор мог лишь
 * предложить правку. «Заметил, но чинить не берусь» — тоже полезная новость, и у людей
 * для неё есть задача.
 *
 * Ссылка на список везде одна и та же: `handle/slug` или просто `slug` — как у остальных
 * инструментов. Отвечает всё это адресом на сайте: агенту работать по номеру, а человеку
 * — открыть и посмотреть.
 */
const list = z.string().describe('List reference: "handle/slug" or just "slug"')
const number = z.number().int().min(1).describe('Issue number within the list, e.g. 12')

export function registerIssues({ readTool, writeTool }: ToolKit) {
  readTool(
    'search_issues',
    {
      title: 'Find issues in a list',
      description:
        'Search the issues of one list. Words are matched in the title, the body AND the replies — the answer is often in the thread rather than in the description; a query made only of digits also matches the issue number. State is "open" or "closed" (the site has those two tabs and no "all"), so ask twice if you need both.',
      inputSchema: {
        list,
        q: z.string().optional().describe('Words to look for; omit to list the whole tab'),
        state: z.enum(['open', 'closed']).optional().describe('Which tab to search (default "open")'),
        sort: z
          .enum(['newest', 'oldest', 'updated', 'least-updated', 'most-commented', 'least-commented'])
          .optional()
          .describe('Order of results (default "newest")'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
      },
    },
    async (userId, args) => {
      const res = await mcpSearchIssues(userId, args)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  readTool(
    'get_issue',
    {
      title: 'Read an issue with its thread',
      description:
        'Read one issue: title, body, state, labels and the THREAD — replies and events (closed, reopened, locked, closed by a suggestion) in one chronological list. If the discussion is locked, the answer says so and why, so you know before writing.',
      inputSchema: {
        list,
        number,
        limit: z.number().int().min(1).max(200).optional().describe('Max replies to include (default 50)'),
      },
    },
    async (userId, args) => {
      const res = await mcpGetIssue(userId, args)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  writeTool(
    'create_issue',
    {
      title: 'Open an issue on a list',
      description:
        "Report a problem or an idea about a list — yours or someone else's. Use this when you noticed something but are not making the fix yourself; when you ARE making the fix, suggest_edit carries the change. The list owner and everyone watching get notified.",
      inputSchema: {
        list,
        title: z.string().describe('One line: what is wrong or what is proposed'),
        body: z.string().optional().describe('The details — what you saw, where, and why it matters (Markdown)'),
        labels: z.array(z.string()).optional().describe('Label ids already defined in the list'),
      },
    },
    async (userId, args) => {
      const res = await mcpCreateIssue(userId, args)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  writeTool(
    'add_issue_comment',
    {
      title: 'Reply in an issue thread',
      description:
        'Post a reply in the thread of an issue. Everyone in the thread — the author, the list owner, previous commenters and watchers — is notified. A locked discussion refuses the reply and says so.',
      inputSchema: { list, number, body: z.string().describe('What you want to say (Markdown)') },
    },
    async (userId, args) => {
      const res = await mcpAddIssueComment(userId, args)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  writeTool(
    'close_issue',
    {
      title: 'Close an issue with an outcome',
      description:
        'Close an issue — the author of the issue or the list owner may do it. The outcome is REQUIRED because a closed issue looks the same either way: "completed" (it was done), "not_planned" (it will not be done) or "duplicate" (it is already reported), and a duplicate must name the original with duplicateOf. Wrong number, no close: the call is refused instead of dropping the link.',
      inputSchema: {
        list,
        number,
        stateReason: z.enum(['completed', 'not_planned', 'duplicate']).describe('How it ended'),
        duplicateOf: z.number().int().min(1).optional().describe('Number of the original issue in the SAME list — required for "duplicate"'),
      },
    },
    async (userId, args) => {
      const res = await mcpCloseIssue(userId, args)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  writeTool(
    'reopen_issue',
    {
      title: 'Reopen a closed issue',
      description:
        'Reopen a closed issue — the author of the issue or the list owner. The previous outcome is cleared from the issue itself but stays in its timeline, so the history of "closed as not planned, then reopened" is not rewritten.',
      inputSchema: { list, number },
    },
    async (userId, args) => {
      const res = await mcpReopenIssue(userId, args)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )
}
