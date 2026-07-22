import { createHash } from 'node:crypto'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { z } from 'zod'
import { verifyApiToken } from '@/shared/auth/api-token'
import { clientIp, rateLimit, tooMany } from '@/shared/rate-limit'
import { mcpCheckStep, mcpCreateList, mcpGetList, mcpGetRun, mcpGetScript, mcpSearch, mcpStartRun, mcpUpdateList } from '@/features/mcp/tools'
import { mcpAskGnome, mcpGnomeReview, mcpListGnomes } from '@/features/mcp/gnome'
import { mcpCouncilDraft, mcpGetCouncilDraft } from '@/features/mcp/council'

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })
const err = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })

type Extra = { authInfo?: AuthInfo }
const userIdOf = (extra: Extra) => extra.authInfo?.extra?.userId as string | undefined
const canWrite = (extra: Extra) => (extra.authInfo?.scopes ?? []).includes('write')
const READONLY = 'This token is read-only. Use an API token with write scope for this action.'

const handler = createMcpHandler(
  (server) => {
    // Регистрация с ВШИТОЙ авторизацией. Токен несёт scope (read | read+write).
    // readTool требует только userId; writeTool — userId + write-scope. Скоуп — часть
    // СПОСОБА регистрации: новый мутирующий инструмент нельзя завести без проверки (раньше
    // проверка была отдельной строкой в каждом хендлере — её легко забыть, и read-токен писал).
    type ToolFn = (userId: string, args: any, extra: Extra) => Promise<ReturnType<typeof json> | ReturnType<typeof err>>
    // registerTool перегружен (с/без inputSchema) — оборачиваем через приведённую сигнатуру,
    // чтобы навесить проверку scope единообразно. Зод-схема валидирует args в рантайме.
    const register = server.registerTool.bind(server) as unknown as (
      name: string,
      config: unknown,
      cb: (args: any, extra: Extra) => unknown,
    ) => void
    const readTool = (name: string, config: unknown, fn: ToolFn) =>
      register(name, config, async (args, extra) => {
        const userId = userIdOf(extra)
        if (!userId) return err('Unauthorized')
        return fn(userId, args, extra)
      })
    const writeTool = (name: string, config: unknown, fn: ToolFn) =>
      register(name, config, async (args, extra) => {
        const userId = userIdOf(extra)
        if (!userId) return err('Unauthorized')
        if (!canWrite(extra)) return err(READONLY)
        return fn(userId, args, extra)
      })

    // ── READ-инструменты (только userId) ─────────────────────────────
    readTool(
      'search_lists',
      {
        title: 'Search lists',
        description: 'Search public SetFork lists (and your own private ones) by keywords/meaning. Returns list refs "owner/slug".',
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
          'Fetch a full list by ref (owner handle + slug). Returns ALL blocks with their type — steps (title/command/subtasks/links) plus text, image, poll, video and quiz blocks with their content — so you get the complete context, not just text.',
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
          'Render a list as a ready-to-run script (its commands, with progress echoes). dialect: "sh" bash (default), "ps1" PowerShell, "py" python. Commands come from the list authors — review before running.',
        inputSchema: {
          handle: z.string().describe('Owner handle, e.g. "acme"'),
          slug: z.string().describe('List slug, e.g. "deploy-to-vps"'),
          dialect: z.enum(['sh', 'ps1', 'py']).optional().describe('Script dialect (default "sh")'),
        },
      },
      async (userId, { handle, slug, dialect }) => {
        const r = await mcpGetScript(userId, handle, slug, dialect)
        return r ? json(r) : err('List not found or not accessible')
      },
    )

    readTool(
      'get_run',
      {
        title: 'Get run progress',
        description: 'Fetch a run by its id: steps with done/not-done and overall progress.',
        inputSchema: { runId: z.string().describe('The run id from start_run') },
      },
      async (userId, { runId }) => {
        const res = await mcpGetRun(userId, runId)
        return 'error' in res ? err(res.error as string) : json(res)
      },
    )

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

    // Блок списка. type по умолчанию 'step'. Для не-step заполняй поля своего типа.
    const itemShape = z.object({
      type: z.enum(['step', 'text', 'image', 'poll', 'video', 'quiz']).optional().describe('Block type (default "step")'),
      // step
      title: z.string().optional().describe('Step title (short imperative) — for type "step"'),
      desc: z.string().optional().describe('Step: one or two clarifying sentences (light markdown ok)'),
      command: z.string().optional().describe('Step: shell command, if any'),
      level: z.enum(['required', 'recommended', 'optional']).optional().describe('Step: how essential it is'),
      why: z.string().optional().describe('Step: why this step matters (rationale)'),
      section: z.string().optional().describe('Step: optional section header; consecutive steps sharing it are grouped'),
      subtasks: z.array(z.string()).optional().describe('Step: verification checks'),
      // text
      text: z.string().optional().describe('Text block: markdown content — for type "text"'),
      // image / video
      caption: z.string().optional().describe('image/video: caption'),
      imageRef: z.string().optional().describe('image: storage key of an already-uploaded image (rarely set via API)'),
      url: z.string().optional().describe('video: link to YouTube/Vimeo or a direct .mp4/.webm; file: link to the attachment'),
      fileName: z.string().optional().describe('file: display name of the attachment — for type "file"'),
      // poll / quiz
      question: z.string().optional().describe('poll/quiz: the question'),
      options: z
        .array(z.object({ text: z.string(), correct: z.boolean().optional().describe('quiz choice only: mark this option correct') }))
        .optional()
        .describe('poll / quiz(choice): answer options'),
      multi: z.boolean().optional().describe('poll / quiz(choice): allow multiple selections / multiple correct'),
      deadline: z.string().optional().describe('poll: ISO date after which voting closes'),
      explain: z.string().optional().describe('quiz: explanation shown after checking'),
      quizKind: z.enum(['choice', 'text', 'number', 'blank', 'match', 'sort', 'code']).optional().describe('quiz answer type (default "choice")'),
      pairs: z.array(z.object({ left: z.string(), right: z.string() })).optional().describe('quiz(match): correct left→right pairs (rights shuffled for the learner)'),
      sortItems: z.array(z.string()).optional().describe('quiz(sort): items in the CORRECT order (shuffled for the learner); code: reuses accept'),
      accept: z.array(z.string()).optional().describe('quiz(text): accepted answers (any match counts)'),
      caseSensitive: z.boolean().optional().describe('quiz(text/blank): match case exactly'),
      answer: z.number().optional().describe('quiz(number): the correct number'),
      tolerance: z.number().optional().describe('quiz(number): allowed +/- tolerance'),
      template: z.string().optional().describe('quiz(blank): text with ___ where each blank goes'),
      blanks: z.array(z.array(z.string())).optional().describe('quiz(blank): accepted answers per blank, in order'),
    })

    // ── WRITE-инструменты (userId + write-scope, вшито в writeTool) ────
    writeTool(
      'create_list',
      {
        title: 'Create a list',
        description:
          'Create a new list owned by you. It is created as a PRIVATE DRAFT — you publish it later on the site. Items can be plain steps or richer blocks (text, image, poll, video, quiz) — set each item\'s "type". Content language is auto-detected (or pass "lang"); the slug is generated from the title (Cyrillic is transliterated). Per-step "subtasks" are VERIFICATION CHECKS shown to the person doing the step — phrase them as checkable conditions, not sub-steps. If you need an existing list\'s ref, call search_lists first.',
        inputSchema: {
          title: z.string().describe('List title'),
          lang: z.enum(['en', 'ru']).optional().describe('Content language; omit to auto-detect from the title/description'),
          desc: z.string().optional().describe('One-line description'),
          tags: z.array(z.string()).optional().describe('3-6 short tags'),
          ordered: z.boolean().optional().describe('true = ordered steps, false = unordered set (default true)'),
          items: z.array(itemShape).min(1).describe('The blocks (steps and optionally text/image/poll/video/quiz)'),
        },
      },
      async (userId, args) => {
        const res = await mcpCreateList(userId, args)
        return 'error' in res ? err(res.error as string) : json(res)
      },
    )

    writeTool(
      'update_list',
      {
        title: 'Update a list',
        description: 'Replace the blocks of a list you own (steps and/or text/image/poll/video/quiz). A draft is edited in place; a published list gets a new version.',
        inputSchema: {
          handle: z.string().describe('Owner handle (must be you)'),
          slug: z.string().describe('List slug'),
          items: z.array(itemShape).min(1).describe('The new full set of blocks'),
          note: z.string().optional().describe('Change note (for published lists)'),
          tags: z.array(z.string()).optional(),
          ordered: z.boolean().optional(),
        },
      },
      async (userId, { handle, slug, ...rest }) => {
        const res = await mcpUpdateList(userId, handle, slug, rest)
        return 'error' in res ? err(res.error as string) : json(res)
      },
    )

    writeTool(
      'start_run',
      {
        title: 'Start a run',
        description: 'Start (or resume your active) run of a list by ref — a personal pass to track progress. Returns the run id, steps and progress.',
        inputSchema: {
          handle: z.string().describe('Owner handle'),
          slug: z.string().describe('List slug'),
        },
      },
      async (userId, { handle, slug }) => {
        const res = await mcpStartRun(userId, handle, slug)
        return 'error' in res ? err(res.error as string) : json(res)
      },
    )

    writeTool(
      'check_step',
      {
        title: 'Check off a run step',
        description:
          'Report the outcome of a run step by its number (like a CI step). done true/false marks it passed/not; blocked true marks it failed with an optional reason. Omit all to toggle done. Returns the updated run.',
        inputSchema: {
          runId: z.string().describe('The run id'),
          step: z.number().int().min(1).describe('Step number (1-based)'),
          done: z.boolean().optional().describe('true = done, false = not done'),
          blocked: z.boolean().optional().describe('true = this step failed / could not be completed'),
          reason: z.string().optional().describe('Why it failed (used with blocked)'),
        },
      },
      async (userId, { runId, step, done, blocked, reason }) => {
        const res = await mcpCheckStep(userId, runId, step, { done, blocked, reason })
        return 'error' in res ? err(res.error as string) : json(res)
      },
    )
  },
  { serverInfo: { name: 'setfork', version: '0.1.0' }, capabilities: { tools: {} } },
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
