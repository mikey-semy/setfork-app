import { z } from 'zod'
import { mcpBulkCreate, mcpCreateList, mcpDeleteList, mcpDiscardDraft, mcpPatchList, mcpPublishDraft, mcpUpdateList } from '@/features/mcp/tools'
import { itemShape } from './block-schema'
import { err, json, type ToolKit } from './kit'

/** Списки: создание, замена, точечная правка, черновики, удаление, пакетный ввод. */
export function registerListTools({ readTool, writeTool }: ToolKit) {
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
}
