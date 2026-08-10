import { z } from 'zod'
import { mcpApplySuggestion, mcpMergeSuggestion, mcpPendingSuggestions, mcpReportCheck, mcpRevertSuggestion, mcpReviewSuggestion, mcpSuggestEdit } from '@/features/mcp/tools'
import { itemShape } from './block-shape'
import { json, err, type ToolKit } from './kit'

/** Предложения и проверки: очередь, применение, ревью, слияние, откат, отчёт. */
export function registerSuggestions({ readTool, writeTool }: ToolKit) {
  readTool(
    'pending_suggestions',
    {
      title: 'Suggested edits waiting for you',
      description: 'List the OPEN suggested edits on lists you own — what is waiting for your decision. Use apply_suggestion to accept one.',
      inputSchema: { limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)') },
    },
    async (userId, { limit }) => json(await mcpPendingSuggestions(userId, limit ?? 20)),
  )

  writeTool(
    'apply_suggestion',
    {
      title: 'Accept a suggested edit',
      description: 'Accept an open suggested edit on a list you own: it becomes a new version of the list. Get ids from pending_suggestions. A suggestion blocked by a reviewer who requested changes cannot be accepted.',
      inputSchema: { suggestionId: z.string().describe('Suggestion id from pending_suggestions') },
    },
    async (userId, { suggestionId }) => {
      const res = await mcpApplySuggestion(userId, suggestionId)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  // Предложение правки: агент — такой же участник, как человек. Правка ЖДЁТ
  // решения владельца, а не применяется сама (для своих списков есть update_list).
  writeTool(
    'suggest_edit',
    {
      title: 'Suggest an edit to a list',
      description:
        "Propose a change to someone else's list: it becomes a suggestion the owner can accept or reject. The items you pass REPLACE the list content when accepted, so send the full intended list, not just the new lines. Use get_list first to see what is there. For your own lists use update_list instead — it edits directly.",
      inputSchema: {
        list: z.string().describe('List reference: "handle/slug" or just "slug"'),
        note: z.string().describe('What you changed and why — the owner reads this first'),
        items: z.array(itemShape).min(1).describe('The full list content as it should look after the change'),
      },
    },
    async (userId, args) => {
      const res = await mcpSuggestEdit(userId, args as Parameters<typeof mcpSuggestEdit>[1])
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  writeTool(
    'review_suggestion',
    {
      title: 'Review a suggestion',
      description:
        'Leave a verdict on an open suggestion: "approve", "changes" (asks the author to rework it — this BLOCKS merging until the verdict changes) or "comment" (an opinion that blocks nothing). One verdict per reviewer: reviewing again replaces your previous one. You cannot review your own suggestion.',
      inputSchema: {
        list: z.string().describe('List reference: "handle/slug" or just "slug"'),
        number: z.number().int().min(1).describe('Suggestion number within the list, e.g. 12'),
        verdict: z.enum(['approve', 'changes', 'comment']).describe('Your verdict'),
        body: z.string().optional().describe('What exactly you want changed, or why you approve'),
      },
    },
    async (userId, args) => {
      const res = await mcpReviewSuggestion(userId, args)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  writeTool(
    'merge_suggestion',
    {
      title: 'Merge a suggestion',
      description:
        'Merge an open suggestion into the list — the maintainer decision. Works for both kinds: a branch suggestion is merged in git (squash if the list is set that way), an items suggestion becomes a new version. Refuses while a gate holds: a reviewer requested changes, unresolved discussions, missing approvals, a draft, or conflicts. Only the list owner or a collaborator may merge.',
      inputSchema: {
        list: z.string().describe('List reference: "handle/slug" or just "slug"'),
        number: z.number().int().min(1).describe('Suggestion number within the list, e.g. 12'),
      },
    },
    async (userId, args) => {
      const res = await mcpMergeSuggestion(userId, args)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  writeTool(
    'revert_suggestion',
    {
      title: 'Revert a merged suggestion',
      description:
        'Undo a suggestion that was already accepted. It does NOT rewrite history: a NEW suggestion is opened that reverses the change, and it goes through review and merging like any other. Only what that suggestion actually changed is undone — items edited by someone else since the merge are refused by name instead of being overwritten.',
      inputSchema: {
        list: z.string().describe('List reference: "handle/slug" or just "slug"'),
        number: z.number().int().min(1).describe('Number of the ACCEPTED suggestion to revert'),
      },
    },
    async (userId, args) => {
      const res = await mcpRevertSuggestion(userId, args)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

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

  // Регистрация источника — единственная дверь, через которую чужой материал попадает в
  // корпус. Лицензию называет ЧЕЛОВЕК: доступность страницы не означает права копировать.
}
