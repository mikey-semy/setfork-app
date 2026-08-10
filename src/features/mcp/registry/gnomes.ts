import { z } from 'zod'
import { mcpAskGnome, mcpGnomeReview, mcpListGnomes } from '@/features/mcp/gnome'
import { mcpCouncilDraft, mcpGetCouncilDraft } from '@/features/mcp/council'
import { err, json, type ToolKit } from './kit'

/** Советы экспертов и совет: ростер, вопрос одному, ревью, черновик совета. */
export function registerGnomeTools({ readTool, writeTool }: ToolKit) {
  // ── Гномы (мастерская): ростер + вопрос одному эксперту ───────────
  readTool(
    'list_gnomes',
    {
      title: 'List the workshop gnomes',
      description:
        'The SetFork workshop is staffed by gnome experts (chef, devops, coder, coach, traveler, scholar and more). Returns the roster: id, name (en/ru), domains and what each gnome is good at. Call this first to pick whom to ask via ask_gnome.',
      inputSchema: {},
    },
    async () => json(await mcpListGnomes()),
  )

  readTool(
    'ask_gnome',
    {
      title: 'Ask a gnome',
      description:
        'Ask ONE workshop gnome a question in their specialty — advice, a draft outline, or a critique. Optionally attach one of your lists (handle+slug) as context; the gnome will consider its content. Uses your AI quota; costs one model call. Pick the gnome by domain fit (list_gnomes), not at random — a chef will not help with a deploy.',
      inputSchema: {
        gnome: z.string().describe('Gnome id from list_gnomes, e.g. "chef"'),
        question: z.string().describe('Your question or task for this gnome, any language'),
        handle: z.string().optional().describe('Optional: owner handle of a list to attach as context'),
        slug: z.string().optional().describe('Optional: slug of that list (required together with handle)'),
      },
    },
    async (userId, { gnome, question, handle, slug }) => {
      const res = await mcpAskGnome(userId, { gnome, question, handle, slug })
      return 'error' in res ? err(res.error) : json(res)
    },
  )

  readTool(
    'gnome_review',
    {
      title: 'Gnome review of a list',
      description:
        'A guild master reviews an existing list against his guild code and returns concrete fixes: verdict, issues (where/problem/fix) and missing additions. Pick the gnome explicitly or let the workshop match one by the list tags. Costs one model call from your AI quota.',
      inputSchema: {
        handle: z.string().describe('Owner handle of the list'),
        slug: z.string().describe('List slug'),
        gnome: z.string().optional().describe('Optional gnome id from list_gnomes; omit to auto-match by tags'),
      },
    },
    async (userId, { handle, slug, gnome }) => {
      const res = await mcpGnomeReview(userId, { handle, slug, gnome })
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  readTool(
    'get_council_draft',
    {
      title: 'Get a council draft',
      description:
        'Fetch the state of a council draft started with council_draft: status (pending/done/failed/clarify), the council conversation (which gnome said what), and the candidate lists. Poll every ~20s while status is "pending".',
      inputSchema: { draftId: z.string().describe('The draftId from council_draft') },
    },
    async (userId, { draftId }) => {
      const res = await mcpGetCouncilDraft(userId, draftId)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  // ── WRITE: полный совет гномов (тратит AI-квоту как генерация на сайте) ──
  writeTool(
    'council_draft',
    {
      title: 'Convene the gnome council',
      description:
        'Start a FULL gnome council on a topic: the steward classifies it, guild experts draft in parallel, a critic reviews, the elder synthesizes the final list. Takes 1-4 minutes and spends your AI quota (same as drafting on the site). Returns a draftId — poll get_council_draft for the result; the conversation is also visible on the site. For a quick single-expert answer use ask_gnome instead.',
      inputSchema: { query: z.string().describe('What list to build, any language — same as typing into the site') },
    },
    async (userId, { query }) => {
      const res = await mcpCouncilDraft(userId, query)
      return 'error' in res ? err(res.error) : json(res)
    },
  )

}
