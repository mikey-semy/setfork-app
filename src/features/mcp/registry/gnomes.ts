import { z } from 'zod'
import { mcpAskGnome, mcpGnomeReview, mcpListGnomes } from '@/features/mcp/gnome'
import { mcpCouncilDraft, mcpGetCouncilDraft } from '@/features/mcp/council'
import { json, err, type ToolKit } from './kit'

/** Мастерская гномов и совет: ростер, вопрос эксперту, ревью, черновик совета. */
export function registerGnomes({ readTool, writeTool }: ToolKit) {
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

}
