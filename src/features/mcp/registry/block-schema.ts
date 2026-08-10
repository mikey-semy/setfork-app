import { z } from 'zod'

/**
 * ФОРМА БЛОКА в контракте MCP — общая для create_list/update_list и для
 * предложений правки. Одна схема на оба домена: разъедься они, агент получил бы
 * разный набор полей в зависимости от того, каким инструментом пишет.
 */
// Блок списка. type по умолчанию 'step'. Для не-step заполняй поля своего типа.
export const itemShape = z.object({
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
