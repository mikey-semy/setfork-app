import { createHash } from 'node:crypto'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { z } from 'zod'
import { APP_VERSION } from '@/shared/app-version'
import { getBuildId } from '@/shared/version'
import { verifyApiToken } from '@/shared/auth/api-token'
import { clientIp, rateLimit, tooMany } from '@/shared/rate-limit'
import {
  mcpApplySuggestion,
  mcpBulkCreate,
  mcpCheckStep,
  mcpCreateList,
  mcpGetList,
  mcpGetRun,
  mcpGetScript,
  mcpListSources,
  mcpPendingSuggestions,
  mcpMergeSuggestion,
  mcpPatchList,
  mcpReportCheck,
  mcpRevertSuggestion,
  mcpReviewSuggestion,
  mcpSuggestEdit,
  mcpRegisterSource,
  mcpSearch,
  mcpStartRun,
  mcpUpdateList,
  mcpDeleteList,
  mcpPublishDraft,
  mcpDiscardDraft,
} from '@/features/mcp/tools'
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
    // ПОДСКАЗКИ АГЕНТУ — часть способа регистрации, как и скоуп. Аннотации MCP
    // (readOnlyHint/destructiveHint/idempotentHint/openWorldHint) клиент показывает
    // модели и по ним же решает, спрашивать ли человека перед вызовом. Проставляем их
    // здесь, а не в каждом инструменте: иначе новый инструмент однажды приедет без
    // подсказок, и агент будет гадать, что тот делает. Отдельный инструмент может
    // уточнить свои (например delete_list — destructiveHint).
    type ToolConfig = { title?: string; description?: string; inputSchema?: unknown; annotations?: Record<string, unknown> }
    const annotate = (config: unknown, base: Record<string, unknown>) => {
      const c = (config ?? {}) as ToolConfig
      return { ...c, annotations: { ...(c.title ? { title: c.title } : {}), ...base, ...(c.annotations ?? {}) } }
    }
    const readTool = (name: string, config: unknown, fn: ToolFn) =>
      register(name, annotate(config, { readOnlyHint: true, idempotentHint: true, openWorldHint: false }), async (args, extra) => {
        const userId = userIdOf(extra)
        if (!userId) return err('Unauthorized')
        return fn(userId, args, extra)
      })
    const writeTool = (name: string, config: unknown, fn: ToolFn) =>
      register(name, annotate(config, { readOnlyHint: false, destructiveHint: false, openWorldHint: false }), async (args, extra) => {
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
          'Fetch a full list by ref (owner handle + slug). Returns ALL blocks with their type — steps (title/command/subtasks/links) plus text, image, poll, video and quiz blocks with their content — so you get the complete context, not just text. If YOU have unpublished edits on this list, they come back as "pendingEdits" (their own blocks and baseVersion) — patch those further with publish:false or publish them with publish_draft.',
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
      type: z.enum(['step', 'text', 'image', 'poll', 'video', 'quiz', 'file']).optional().describe('Block type (default "step")'),
      // Идентичность блока: пришла — блок остаётся тем же (комментарии, голоса,
      // попытки, merge по id). Не пришла — заводится новый блок.
      bid: z
        .string()
        .optional()
        .describe('Stable block id as returned by get_list. Keep it to edit an existing block; omit it to create a new one'),
      // step
      title: z.string().optional().describe('Step title (short imperative) — for type "step"'),
      desc: z.string().optional().describe('Step: one or two clarifying sentences (light markdown ok)'),
      command: z.string().optional().describe('Step: shell command, if any'),
      level: z.enum(['required', 'recommended', 'optional']).optional().describe('Step: how essential it is'),
      why: z.string().optional().describe('Step: why this step matters (rationale)'),
      section: z.string().optional().describe('Step: optional section header; consecutive steps sharing it are grouped'),
      subtasks: z.array(z.string()).optional().describe('Step: verification checks'),
      needsHuman: z.boolean().optional().describe('Step: mark that this point needs a human — local prices, taste, personal experience'),
      needsHumanAsk: z.string().optional().describe('Step: what exactly to ask the human (shown with the mark)'),
      refs: z
        .array(
          z.object({
            url: z.string().optional().describe('Link target, e.g. "https://docs.astral.sh/uv/"'),
            label: z.string().optional().describe('Link text; omit it and the UI shows the domain'),
          }),
        )
        .optional()
        .describe('Step: reference links shown under the step (docs, sources). One link is just {"url": "..."} — label is optional. get_list returns them in the same shape'),
      // text
      text: z.string().optional().describe('Text block: markdown content — for type "text"'),
      // image / video
      caption: z.string().optional().describe('image/video: caption'),
      imageRef: z.string().optional().describe('image: storage key of an already-uploaded image (rarely set via API)'),
      url: z.string().optional().describe('video: link to YouTube/Vimeo or a direct .mp4/.webm; file: link to the attachment'),
      fileName: z.string().optional().describe('file: display name of the attachment — for type "file"'),
      // get_list отдаёт file.name и image.ref — принимаем их под теми же именами,
      // чтобы прочитанный список можно было отдать обратно в update_list как есть.
      name: z.string().optional().describe('file: same as fileName — the shape get_list returns'),
      ref: z.string().optional().describe('image: same as imageRef — the shape get_list returns'),
      // poll / quiz
      question: z.string().optional().describe('poll/quiz: the question'),
      options: z
        .array(
          z.object({
            // id варианта — якорь голосов (poll_votes) и попыток (quiz_attempts):
            // перевыдал его при перезаписи — осиротил чужие голоса.
            id: z.string().optional().describe('Stable option id as returned by get_list; keep it so existing votes/attempts stay attached'),
            text: z.string(),
            correct: z.boolean().optional().describe('quiz choice only: mark this option correct'),
          }),
        )
        // Один id у двух вариантов = два неразличимых ответа: интерфейс ключует
        // их по id, голоса и попытки адресуются им же. Пустые не проверяем —
        // им id выдаётся при записи.
        .refine(
          (opts) => {
            const ids = opts.map((o) => (o.id ?? '').trim()).filter(Boolean)
            return new Set(ids).size === ids.length
          },
          { message: 'option ids must be unique within the block' },
        )
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
          items: z.array(itemShape).min(1).describe('The blocks (steps and optionally text/image/poll/video/quiz/file)'),
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
        // Замена всего состава: незаданный блок ИСЧЕЗАЕТ — для агента это разрушающая
        // операция, и клиент вправе спросить человека. Точечная правка — patch_list.
        annotations: { destructiveHint: true },
        description:
          'Replace ALL blocks of a list you own (steps and/or text/image/poll/video/quiz/file) — anything you omit is removed. For editing a few blocks use patch_list instead. A draft is edited in place; a published list gets a new version.',
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

    // Точечная правка вместо перезаписи всего списка. Адресация — по стабильному
    // bid блока (как в Notion), а не по индексу: индекс сдвигает любая вставка.
    writeTool(
      'patch_list',
      {
        title: 'Patch a list',
        description:
          'Edit SPECIFIC blocks of a list you own instead of resending the whole list. Ops address blocks by their stable "bid" from get_list: update (change only the fields you pass), insert (new block at start/end/after a bid), delete, move. All ops apply together or none at all. baseVersion is required — pass the "version" you got from get_list; if the list changed meanwhile the patch is rejected so you cannot silently overwrite someone else\'s edit. By default each call publishes a new version; pass publish:false to COLLECT edits instead — they pile up in the same draft the editor shows (get_list returns it as pendingEdits), and publish_draft turns the whole pile into ONE version. Prefer this over update_list for edits; a list that was never published is patched in place.',
        inputSchema: {
          handle: z.string().describe('Owner handle (must be you)'),
          slug: z.string().describe('List slug'),
          baseVersion: z
            .number()
            .int()
            .describe('The "version" get_list returned — or pendingEdits.baseVersion if you already have pending edits, because the patch stacks on top of those'),
          ops: z
            .array(
              z.object({
                op: z.enum(['update', 'insert', 'delete', 'move']).describe('What to do'),
                bid: z.string().optional().describe('Block to update / delete / move (stable id from get_list)'),
                after: z.string().optional().describe('Where to put it (insert, move): "start", "end" (default) or the bid to place it after'),
                block: itemShape.optional().describe('The new block — for op "insert"'),
              })
                // update несёт поля блока прямо в операции: {op:"update", bid, title:"…"}.
                // Незаданное поле остаётся прежним — в этом и смысл точечной правки.
                .and(itemShape.partial()),
            )
            .min(1)
            .describe('Operations, applied in order'),
          note: z.string().optional().describe('Change note (for published lists)'),
          publish: z
            .boolean()
            .optional()
            .describe('Default TRUE — the patch becomes a new version at once. Pass false to collect edits in the draft instead, then call publish_draft.'),
        },
      },
      async (userId, { handle, slug, ...rest }) => {
        const res = await mcpPatchList(userId, handle, slug, rest)
        return 'error' in res ? err(res.error as string) : json(res)
      },
    )

    // Опубликовать накопленные правки одной версией — второй такт к patch_list с
    // publish:false. Без него пачка так и лежала бы черновиком.
    writeTool(
      'publish_draft',
      {
        title: 'Publish pending edits',
        description:
          'Turn the pending edits of this list into ONE new version. TWO-STEP: without confirm it reports what would be published (how many blocks, which version it becomes) and writes nothing; pass confirm:true to publish. Two steps on purpose — the pending edits are shared with the web editor, so unfinished work of yours may be sitting there. Nothing pending — it says so. If the list moved on meanwhile, publishing is refused instead of overwriting the work of others: discard_draft or redo the edits on the fresh version.',
        inputSchema: {
          handle: z.string().describe('Owner handle (must be you)'),
          slug: z.string().describe('List slug'),
          note: z.string().optional().describe('Change note for this version; omitted — the note saved with the draft is used'),
          confirm: z.boolean().optional().describe('Default FALSE — report only. Pass true to actually publish.'),
        },
      },
      async (userId, { handle, slug, note, confirm }) => {
        const res = await mcpPublishDraft(userId, handle, slug, note, confirm === true)
        return 'error' in res ? err(res.error as string) : json(res)
      },
    )

    // Выход из тупика: черновик устарел (список ушёл вперёд) — правки нужно выбросить,
    // иначе publish_draft будет отказывать всегда, а patch_list копить в никуда.
    writeTool(
      'discard_draft',
      {
        title: 'Discard pending edits',
        annotations: { destructiveHint: true, idempotentHint: true },
        description:
          'Throw away the pending (unpublished) edits of this list — the same ones get_list returns as pendingEdits and the web editor shows as a draft. Use it when the list moved on and publishing is refused, or when the collected edits are no longer wanted. The published list itself is untouched.',
        inputSchema: {
          handle: z.string().describe('Owner handle (must be you)'),
          slug: z.string().describe('List slug'),
        },
      },
      async (userId, { handle, slug }) => {
        const res = await mcpDiscardDraft(userId, handle, slug)
        return 'error' in res ? err(res.error as string) : json(res)
      },
    )

    // Убрать свой список. Пока инструмента не было, пробный черновик агента мог
    // удалить только человек руками в интерфейсе (жалоба владельца 04.08.2026).
    writeTool(
      'delete_list',
      {
        title: 'Delete a list',
        annotations: { destructiveHint: true, idempotentHint: true },
        description:
          'Delete a list you own FOR GOOD, with its versions, steps, stars and suggested edits. Two-step by design: without confirm it only reports what would be deleted and writes nothing; pass confirm:true to actually delete. A list locked by moderation cannot be deleted — appeal instead.',
        inputSchema: {
          handle: z.string().describe('Owner handle (must be you)'),
          slug: z.string().describe('List slug'),
          confirm: z.boolean().optional().describe('Default FALSE — report only. Pass true to delete for good.'),
        },
      },
      async (userId, { handle, slug, confirm }) => {
        const res = await mcpDeleteList(userId, handle, slug, confirm === true)
        return 'error' in res ? err(res.error as string) : json(res)
      },
    )

    // Массовая генерация — ускоритель под рукой человека. По умолчанию СУХОЙ ПРОГОН:
    // одним вызовом можно налить сотню списков, и «ой, не то» тут стоит дорого.
    writeTool(
      'bulk_create_lists',
      {
        title: 'Create many lists at once',
        description:
          'Create SEVERAL lists in one call (max 25). DRY RUN BY DEFAULT: it reports what would be created — slugs and duplicates — and writes nothing until you pass dryRun:false. Lists whose title matches one you already have are skipped as duplicates, so re-running after an interruption does not double your library. Each list is created as a PRIVATE DRAFT and the per-account list quota still applies.',
        inputSchema: {
          dryRun: z.boolean().optional().describe('Default TRUE — report the plan without writing. Pass false to actually create.'),
          lists: z
            .array(
              z.object({
                title: z.string().describe('List title'),
                lang: z.enum(['en', 'ru']).optional(),
                desc: z.string().optional(),
                tags: z.array(z.string()).optional(),
                ordered: z.boolean().optional(),
                items: z.array(itemShape).min(1),
              }),
            )
            .min(1)
            .max(25)
            .describe('The lists to create'),
        },
      },
      async (userId, { lists, dryRun }) => {
        const res = await mcpBulkCreate(userId, lists, dryRun !== false)
        return 'error' in res ? err(res.error as string) : json(res)
      },
    )

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
  {
    // Версия = семантическая + идентификатор сборки: семантическая меняется редко, а
    // инструменты приезжают с каждой выкаткой — по хвосту видно, ту ли схему держит клиент.
    serverInfo: { name: 'setfork', version: `${APP_VERSION}+${getBuildId()}` },
    // listChanged заявляем честно: набор инструментов меняется с выкаткой, и клиент
    // должен знать, что список стоит перечитывать, а не держать вечно. Версия сервера
    // берётся из сборки, а не из строки в коде: по ней видно, свежую ли схему держит
    // клиент (жалоба владельца 04.08.2026: клиент отдавал схему без refs).
    capabilities: { tools: { listChanged: true } },
    // instructions агент получает при подключении — это его карта сервера. Без неё он
    // угадывает порядок работы и, например, шлёт список целиком там, где хватило бы
    // точечной правки.
    instructions: [
      'SetFork keeps runnable, versioned checklists ("lists"). A list is a sequence of blocks: step, text, image, poll, video, quiz, file.',
      '',
      'Working loop:',
      '1. Find it: search_lists, then get_list — it returns every block with a stable "bid" and the list "version".',
      '2. Change it: patch_list. Address blocks by "bid", send ONLY the fields you change, pass baseVersion = the "version" from get_list. Ops: update, insert, delete, move.',
      '   Use update_list only to replace the whole set of blocks — anything omitted there is removed.',
      '3. Batch: by default one patch_list call = one new version. To let several rounds of edits land as ONE version, call patch_list with publish:false — they pile up in a draft (get_list shows it as pendingEdits) — and finish with publish_draft (two-step: it reports first, publishes with confirm:true). Stuck because the list moved on? discard_draft throws the pile away.',
      '',
      'Good to know:',
      '- A list that was never published is edited in place; for a published list every write call makes a version unless you pass publish:false.',
      '- baseVersion protects you: if someone edited the list meanwhile, the patch is rejected instead of overwriting their work — re-read with get_list and retry.',
      '- Step links are just {"url": "..."}; a label is optional and the interface falls back to the domain.',
      '- delete_list is irreversible and needs confirm:true; without it the call only reports what would go.',
      '- Write tools need a token with write scope; read tools work with any token.',
    ].join('\n'),
  },
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
