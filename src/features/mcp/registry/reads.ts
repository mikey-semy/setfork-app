import { z } from 'zod'
import { mcpGetList, mcpGetRun, mcpGetScript, mcpSearch } from '@/features/mcp/tools'
import { json, err, type ToolKit } from './kit'

/** Чтение: поиск, список, скрипт, прогон. */
export function registerReads({ readTool, writeTool }: ToolKit) {
  // ── READ-инструменты (только userId) ─────────────────────────────
  readTool(
    'search_lists',
    {
      title: 'Search lists',
      // Что такое ref и почему его мало для доверия — говорится ЗДЕСЬ, в первом
      // инструменте, который агент обычно зовёт: дальше он идёт в get_list, и знать про
      // версию ему нужно уже там.
      description:
        'Search public SetFork lists (and your own private ones) by keywords/meaning. Returns list refs "owner/slug" — a ref points at the list, not at a fixed revision. Fetch it with get_list to get the current version number and its blocks.',
      inputSchema: {
        query: z.string().describe('Search terms — topic, tool or task'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results (default 10)'),
      },
    },
    async (userId, { query, limit }) => json(await mcpSearch(userId, query, limit ?? 10)),
  )

  readTool(
    'get_list',
    {
      title: 'Get a list',
      description:
        'Fetch a full list by ref (owner handle + slug). Returns ALL blocks with their type — steps (title/command/subtasks/links) plus text, image, poll, video and quiz blocks with their content — so you get the complete context, not just text. The response carries "version": a version is a fixed set of bytes, not a moving branch, so quoting owner/slug@version identifies exactly what you read. Pass that number back as baseVersion when you edit — the write is rejected if the list moved on meanwhile, instead of overwriting someone else\'s work. If YOU have unpublished edits on this list, they come back as "pendingEdits" (their own blocks and baseVersion) — patch those further with publish:false or publish them with publish_draft.',
      inputSchema: {
        handle: z.string().describe('Owner handle, e.g. "acme"'),
        slug: z.string().describe('List slug, e.g. "deploy-to-vps"'),
      },
    },
    async (userId, { handle, slug }) => {
      const list = await mcpGetList(userId, handle, slug)
      return list ? json(list) : err('List not found or not accessible')
    },
  )

  readTool(
    'get_script',
    {
      title: 'Get a runnable script',
      description:
        'Render a list as a ready-to-run script (its commands, with progress echoes). Step commands are written for the shell and are NEVER translated between languages, so "sh" (bash, the default) is the only dialect that carries them: asking for "ps1" or "py" on a list that has runnable commands returns an error naming "sh", not a script that would mean something else in another interpreter. Those dialects still work for lists without runnable commands (text, checklists), where the wrapper is the whole script. Pass bid/bids (block ids from get_list) to build a script from just those steps — a reference list of 30 items does not have to come as one script. Destructive steps arrive commented out and are reported in "skipped". Commands come from the list authors — review before running.',
      inputSchema: {
        handle: z.string().describe('Owner handle, e.g. "acme"'),
        slug: z.string().describe('List slug, e.g. "deploy-to-vps"'),
        dialect: z
          .enum(['sh', 'ps1', 'py'])
          .optional()
          .describe('Script dialect (default "sh"). "ps1"/"py" only for lists without runnable commands — commands are not translated'),
        bid: z.string().optional().describe('Single block id — script from just this step'),
        bids: z.array(z.string()).optional().describe('Block ids — script from these steps, always in list order'),
      },
    },
    async (userId, { handle, slug, dialect, bid, bids }) => {
      // Обе формы разом: одна — для «дай мне вот этот пункт», массив — для
      // «собери последовательность». Внутри это один и тот же список адресов.
      const only = [...(bids ?? []), ...(bid ? [bid] : [])]
      const r = await mcpGetScript(userId, handle, slug, dialect, only)
      if (!r) return err('List not found or not accessible')
      if ('error' in r && r.error) return err(r.error)
      return json(r)
    },
  )

  readTool(
    'get_run',
    {
      title: 'Get run progress',
      description:
        'Fetch a run by its id: steps with done/not-done, failure reasons and overall progress. A run is a record of an actual execution — read it when you need evidence that a list works, rather than trusting its description.',
      inputSchema: { runId: z.string().describe('The run id from start_run') },
    },
    async (userId, { runId }) => {
      const res = await mcpGetRun(userId, runId)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

}
