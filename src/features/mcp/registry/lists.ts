import { megabytes } from '@/shared/media/limits'
import { SKILL_ASSETS_MAX_BYTES } from '@/core/domain/skill-limits'
import { z } from 'zod'
import { mcpMyCatalogs, mcpBulkCreate, mcpCreateList, mcpDeleteList, mcpDiscardDraft, mcpImportSkill, mcpMyDrafts, mcpPatchList, mcpPublishDraft, mcpPublishLists, mcpPublishSkill, mcpRenameList, mcpUpdateList, MCP_PUBLISH_MAX } from '@/features/mcp/tools'
import { itemShape, itemShapeLean } from './block-schema'
import { json, err, type ToolKit } from './kit'
import { isContentLang } from '@/shared/i18n/iso639'

/**
 * Язык содержимого — любой код ISO 639-1, а не только языки интерфейса: список пишут на
 * белорусском, немецком, казахском (ADR-0030). Он же становится языком оригинала списка.
 */
const contentLang = z.string().refine(isContentLang, { message: 'lang must be an ISO 639-1 code: en, ru, be, de, …' })

/** Списки: создание, замена, точечная правка, публикация черновика, удаление. */
export function registerLists({ readTool, writeTool }: ToolKit) {
  // ── WRITE-инструменты (userId + write-scope, вшито в writeTool) ────
  writeTool(
    'publish_skill',
    {
      title: 'Publish an Agent Skill',
      // Удаление файлов (removeFiles, replaceFiles) стирает то, что агент может не видеть
      // целиком, — для клиента это разрушающая операция, он вправе спросить человека.
      annotations: { destructiveHint: true },
      description:
        'Put an Agent Skill on SetFork: the blocks AND the author files (scripts/, references/, assets/) land in ONE version, so nobody installs a half-published skill. Without list — creates a new DRAFT (only you see it) whose version 1 already carries the files; publish it with publish_lists to make it installable. Pass skillMd to bring an existing SKILL.md as is — it is split into blocks, and its header (license, compatibility, allowed-tools, metadata) is kept with the list and comes back in the export; a new skillMd REPLACES the kept header. With list + baseVersion — writes a new version of your list: files ADDS or REPLACES the named files and keeps the rest, removeFiles deletes named ones, replaceFiles:true makes files the complete set; items omitted keeps the current blocks; title/desc/tags change the list itself. get_list shows the current files. Same rules as git push: files directly in the three folders, a name up to 100 bytes; scripts/ and references/ hold text only, while a binary file (image, PDF, data) may go to assets/ with encoding:"base64" — its bytes are stored by sha256 and the tree keeps a Git LFS pointer (no native executables; binary files of a skill together at most ' + megabytes(SKILL_ASSETS_MAX_BYTES) + ' MB), only scripts/ may be executable, a limited count and total size (the refusal names the file and the limit); scripts go through the same destructive-command check as steps, and every file, block, title and description is searched for access keys (GitHub, AWS, OpenAI, OpenRouter and other provider tokens, private keys) — a key is refused with its file and line, like GitHub push protection. Refused if you have pending edits (publish_draft or discard_draft them first). A published public skill installs with: npx skills add <site>/<handle>/<slug>/skill.tar.gz',
      inputSchema: {
        list: z.string().optional().describe('Your list "handle/slug" to update; omit to create a new skill'),
        baseVersion: z.number().int().optional().describe('Required with list: the "version" from get_list — the write is rejected if the list moved on'),
        title: z.string().optional().describe('Title — required for a new skill'),
        desc: z
          .string()
          .optional()
          .describe('Description — agents decide whether to use the skill by it: say what it does AND when to use it'),
        tags: z.array(z.string()).optional(),
        ordered: z.boolean().optional(),
        lang: contentLang.optional().describe('Language of the skill text, ISO 639-1 (en, ru, be, de, …); becomes the list\'s source language. Default: detected (only en/ru can be told apart)'),
        catalog: z.string().optional().describe('Your catalog to file the skill into'),
        items: z
          .array(itemShapeLean)
          .optional()
          .describe('Blocks (as in create_list). Required for a new skill; omit when updating to keep the current blocks'),
        skillMd: z
          .string()
          .optional()
          .describe('The whole SKILL.md instead of items: numbered steps become steps, prose becomes text blocks, the header gives title and description (explicit title/desc win). parseNotes in the answer says what was not taken over'),
        files: z
          .array(
            z.object({
              path: z.string().describe('"scripts/run.sh", "references/guide.md", "assets/template.json"'),
              content: z.string().describe('File text (or base64 with encoding:"base64")'),
              encoding: z.enum(['utf8', 'base64']).optional(),
              executable: z
                .boolean()
                .optional()
                .describe('Only for scripts/: keep it executable (mode 755). Omitted — an existing file keeps its mode'),
            }),
          )
          .optional()
          .describe('Files to add or replace; files you do not name stay as they are'),
        removeFiles: z.array(z.string()).optional().describe('Paths of files to delete'),
        replaceFiles: z.boolean().optional().describe('true — files becomes the COMPLETE set and every other file is deleted'),
        note: z.string().optional().describe('Change note of the new version'),
      },
    },
    async (userId, args) => {
      // Полная форма блоков — по той же причине, что в create_list.
      const res = await mcpPublishSkill(userId, { ...args, items: args.items ? z.array(itemShape).parse(args.items) : undefined })
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  writeTool(
    'import_skill',
    {
      title: 'Import an Agent Skill from GitHub',
      description:
        'Bring someone else\'s Agent Skill from GitHub into SetFork as a new DRAFT of yours: the SKILL.md becomes blocks, its header is kept, and scripts/, references/, assets/ come as files — all from one pinned commit, with the source credited. The URL is what `npx skills add` takes: github.com/<owner>/<repo>, …/tree/<ref>/<folder>, …/blob/<ref>/<folder>/SKILL.md or owner/repo. VISIBILITY FOLLOWS THE LICENSE: an open license (MIT, Apache-2.0, BSD, GPL, CC-BY…) lets the list be public once you publish it; no license, a proprietary or non-commercial one makes it PRIVATE for good — only you see it and it cannot be made public. Files in subfolders, binary files outside assets/, native executables and oversized sets are skipped or refused and named; binary files in assets/ come along (stored by sha256). At most 10 imports an hour.',
      inputSchema: {
        url: z.string().describe('GitHub address of the skill: repository, its folder, or its SKILL.md'),
      },
    },
    async (userId, args) => {
      const res = await mcpImportSkill(userId, args)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  writeTool(
    'create_list',
    {
      title: 'Create a list',
      description:
        'Create a new list owned by you. It is created as a PRIVATE DRAFT — you publish it later on the site. For an Agent Skill that carries files (scripts/, references/, assets/) use publish_skill instead: blocks and files land in one version. Publishing makes version 1; every later edit makes the next version, and old ones stay readable. Items can be plain steps or richer blocks (text, image, poll, video, quiz) — set each item\'s "type". Content language is auto-detected (or pass "lang"); the slug is generated from the title (Cyrillic is transliterated). Per-step "subtasks" are VERIFICATION CHECKS shown to the person doing the step — phrase them as checkable conditions, not sub-steps. If you need an existing list\'s ref, call search_lists first. Creating several lists at once? Use bulk_create_lists — one call instead of N.\n\nHOW TO LAY A LIST OUT — one block is one thing, and headings live in "section":\n• "section" is a HEADING ABOVE a block and works on ANY block type. Consecutive blocks sharing it are grouped under it and it lands in the table of contents. Do not fake headings by writing "## Heading" at the top of a text block — the reader sees it glued to that block, the next block looks like part of it, and the contents misses it.\n• One block = one item. A person, a rule, an idea — its own block, so it can be moved, quoted and patched by bid later.\n• "step" for something the reader DOES (it gets a number and a checkbox); "text" for prose that is only read. Mixing them is fine: frames as text, actions as steps.\n• Sources and links go in "refs" — on a step OR a text block; they show under the block as link chips. Do not write a "Sources: [..](..)" line into the text: there they are not the block\'s links and cannot be edited as links.\n• Markdown inside a block is for emphasis, lists, quotes and code — not for structure. Structure is blocks and sections.\n• ⚠️ Rendering is strict CommonMark: a SINGLE newline inside a paragraph is NOT a line break — it is joined into one line, unlike GitHub comments. Separate paragraphs with a BLANK line. You cannot see the result, so this is the one layout rule you have to take on trust.',
      inputSchema: {
        title: z.string().describe('List title'),
        lang: contentLang.optional().describe('Content language, ISO 639-1 (en, ru, be, de, …); becomes the list\'s source language. Omit to auto-detect from the title/description — only en/ru can be told apart, so pass it for any other language'),
        desc: z.string().optional().describe('One-line description'),
        tags: z.array(z.string()).optional().describe('3-6 short tags'),
        catalog: z
          .string()
          .optional()
          .describe('Name of one of your catalogs (shelves) to file the list under. Unknown name = the list stays unfiled and the response says so.'),
        ordered: z.boolean().optional().describe('true = ordered steps, false = unordered set (default true)'),
        items: z
          .array(itemShapeLean)
          .min(1)
          .describe(
            'The blocks. Fields for step and text are listed here; quiz/poll/video/image/file blocks are also accepted — their fields are documented in patch_list',
          ),
      },
    },
    async (userId, args) => {
      // ⚠️ Разбираем ПОЛНОЙ формой: снаружи объявлена облегчённая (см. block-schema),
      // и поля редких типов приходят сквозь `passthrough`. Без этого шага они уехали бы
      // в сервис непроверенными — то есть экономия токенов обернулась бы тихой потерей
      // данных, а это ровно то, ради чего экономии не делают.
      const items = z.array(itemShape).parse(args.items)
      const res = await mcpCreateList(userId, { ...args, items })
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  writeTool(
    'rename_list',
    {
      title: 'Change the address of a list',
      // Ничего не стирает: прежний адрес остаётся вести сюда же навсегда, и вернуться к нему
      // можно тем же вызовом. Поэтому не разрушающий — но и не идемпотентный: повтор с тем
      // же адресом отвечает «уже так».
      description:
        'Change the address (slug) of a list you own: handle/old-slug becomes handle/new-slug. The title is not touched (change it with update_list, patch_list or publish_skill). The old address keeps redirecting to the list forever — the page, git clone/push and skill downloads — and you can switch back to it later. Letters are lower-cased and spaces become hyphens; if the address is taken the refusal suggests a free one.',
      inputSchema: {
        list: z.string().describe('Your list: "handle/slug" (an old address works too)'),
        slug: z.string().describe('The new address, e.g. "finetooth"'),
      },
    },
    async (userId, args) => {
      const res = await mcpRenameList(userId, args)
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
        'Replace ALL blocks of a list you own (steps and/or text/image/poll/video/quiz/file) — anything you omit is removed. For editing a few blocks use patch_list instead. baseVersion is required, exactly as for patch_list: if the list changed meanwhile the replacement is rejected instead of dropping those edits. Every write call makes a new version unless you pass publish:false — this holds for drafts and published lists alike. Layout rules are the same as in create_list — including that a single newline does NOT break a line.',
      inputSchema: {
        handle: z.string().describe('Owner handle (must be you)'),
        slug: z.string().describe('List slug'),
        // ⚠️ ОБЯЗАТЕЛЬНОЕ поле в поверхности, которая уезжает агенту в КАЖДОМ запросе и
        // оплачивается пользователем. Заведено осознанно: инструмент стирает всё, чего в
        // нём нет, и без базы он молча вытеснял версию, опубликованную между чтением
        // агента и его записью. Необязательное поле эту дыру не закрыло бы — открытой
        // осталась бы ровно у того, кто про защиту не подумал.
        // `required_error` — не украшение: SDK печатает сообщение зод-проблемы как есть,
        // и без него отказ звучал бы «Required» — тупик вместо следующего шага
        // (docs/mcp-surface.md, свойство 4).
        baseVersion: z
          .number({
            required_error:
              'baseVersion is required: pass the "version" from get_list (or pendingEdits.baseVersion if edits are already pending) — without it a full replacement would silently drop edits made meanwhile. To change only some blocks, use patch_list.',
          })
          .int()
          .describe('The "version" get_list returned — the replacement is rejected if the list moved on'),
        items: z
          .array(itemShapeLean)
          .min(1)
          .describe('The new full set of blocks (fields as in create_list; full block shape in patch_list)'),
        note: z.string().optional().describe('Change note (for published lists)'),
        tags: z.array(z.string()).optional(),
        ordered: z.boolean().optional(),
        publish: z
          .boolean()
          .optional()
          .describe('false — collect the replacement in the working copy instead of publishing a version; publish_draft turns it into ONE version'),
      },
    },
    async (userId, { handle, slug, ...rest }) => {
      // Полная форма — по той же причине, что в create_list.
      const res = await mcpUpdateList(userId, handle, slug, { ...rest, items: z.array(itemShape).parse(rest.items) })
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  // Точечная правка вместо перезаписи всего списка. Адресация — по стабильному
  // bid блока (как в Notion), а не по индексу: индекс сдвигает любая вставка.
  writeTool(
    'patch_list',
    {
      title: 'Patch a list',
      // ⚠️ Разрушающий: среди операций есть `delete` — блок исчезает из текущего состава.
      // История при этом цела (версии неизменяемы), но клиент вправе спросить человека
      // перед вызовом, который может стереть чужой блок.
      annotations: { destructiveHint: true },
      description:
        'Edit SPECIFIC blocks of a list you own instead of resending the whole list. Ops address blocks by their stable "bid" from get_list: update (change only the fields you pass), insert (new block at start/end/after a bid), delete, move. All ops apply together or none at all. baseVersion is required — pass the "version" you got from get_list; if the list changed meanwhile the patch is rejected so you cannot silently overwrite someone else\'s edit. By default each call publishes a new version; pass publish:false to COLLECT edits instead — they pile up in the same draft the editor shows (get_list returns it as pendingEdits), and publish_draft turns the whole pile into ONE version. Prefer this over update_list for edits. This works the same whether or not the list is published. Layout rules are the same as in create_list: a heading between items is the "section" field on the following block (works on ANY block type), not a "## Heading" line written inside a text block.',
      inputSchema: {
        handle: z.string().describe('Owner handle (must be you)'),
        slug: z.string().describe('List slug'),
        baseVersion: z
          // `required_error` виден только в отказе и в поверхность НЕ уезжает
          // (zodToJsonSchema сообщений не сериализует) — то есть учит бесплатно.
          .number({
            required_error:
              'baseVersion is required: pass the "version" from get_list (or pendingEdits.baseVersion if edits are already pending) — without it the patch could silently overwrite an edit made meanwhile.',
          })
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
        'Turn the pending edits of this list into ONE new version — for publishing a whole unpublished list use publish_lists instead. TWO-STEP: without confirm it reports what would be published (how many blocks, which version it becomes) and writes nothing; pass confirm:true to publish. Two steps on purpose — the pending edits are shared with the web editor, so unfinished work of yours may be sitting there. Nothing pending — it says so. If the list moved on meanwhile, publishing is refused instead of overwriting the work of others: discard_draft or redo the edits on the fresh version.',
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

  // ПОЛКИ. Без этого чтения параметр `catalog` был почти нерабочим: в интерфейсе полка
  // подписана заголовком («Скиллы»), а раскладка ищет техническое имя (`skills`), и узнать
  // его агенту было неоткуда — он раз за разом получал бы «нет такой полки».
  readTool(
    'my_catalogs',
    {
      title: 'My catalogs',
      description:
        'Your catalogs (shelves) with both names: the technical one to pass as "catalog" when creating a list, and the title shown on the site. Also how many lists each already holds — call this before create_list/bulk_create_lists if you intend to file the new lists.',
      inputSchema: {},
    },
    async (userId) => json(await mcpMyCatalogs(userId)),
  )

  // РАЗБОР ЗАВАЛА. Черновики не видны ни поиску, ни ленте — значит через ассистента их
  // было не разобрать вовсе, а по одному через сайт сотня списков занимает часы.
  readTool(
    'my_drafts',
    {
      title: 'My unpublished lists',
      description:
        'Your unpublished (draft) lists — what is waiting for a decision. Returns refs, tags and how many blocks each has, so you can tell a finished list from a stub. Filter by tag to review one family at a time. Publish the ones you picked with publish_lists.',
      inputSchema: {
        tag: z.string().optional().describe('Only drafts carrying this tag'),
        limit: z.number().int().min(1).max(100).optional().describe('How many to return (default 25)'),
      },
    },
    async (userId, { tag, limit }) => json(await mcpMyDrafts(userId, { tag, limit })),
  )

  writeTool(
    'publish_lists',
    {
      title: 'Publish drafts',
      description:
        `Publish your drafts in one call (max ${MCP_PUBLISH_MAX}) — this is for whole unpublished lists; to publish pending EDITS of one list use publish_draft. DRY RUN BY DEFAULT: it reports what would be published and writes nothing until you pass dryRun:false. This does NOT bypass moderation — a published public list goes through the same gate as the button on the site: it becomes "pending" and is auto-checked, and anything already flagged or hidden stays that way. Lists that are not yours or not drafts are skipped with a reason.`,
      inputSchema: {
        refs: z.array(z.string()).min(1).describe('Refs from my_drafts, e.g. ["me/deploy-to-vps"]'),
        dryRun: z.boolean().optional().describe('Default TRUE — report the plan without publishing. Pass false to publish.'),
      },
    },
    async (userId, { refs, dryRun }) => {
      const res = await mcpPublishLists(userId, refs, dryRun !== false)
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
        'Create SEVERAL lists in one call (max 25). DRY RUN BY DEFAULT: it reports what would be created — slugs and duplicates — and writes nothing until you pass dryRun:false. Lists whose title matches one you already have are skipped as duplicates, so re-running after an interruption does not double your library. Each list is created as a PRIVATE DRAFT and the per-account list quota still applies. Layout rules are the same as in create_list — including that a single newline does NOT break a line.',
      inputSchema: {
        dryRun: z.boolean().optional().describe('Default TRUE — report the plan without writing. Pass false to actually create.'),
        lists: z
          .array(
            z.object({
              title: z.string().describe('List title'),
              lang: contentLang.optional(),
              desc: z.string().optional(),
              tags: z.array(z.string()).optional(),
              catalog: z.string().optional().describe('Name of one of your catalogs to file this list under'),
              ordered: z.boolean().optional(),
              items: z.array(itemShapeLean).min(1),
            }),
          )
          .min(1)
          .max(25)
          .describe('The lists to create'),
      },
    },
    async (userId, { lists, dryRun }: { lists: { items: unknown[] }[]; dryRun?: boolean }) => {
      // Полная форма — по той же причине, что в create_list.
      const full = lists.map((l) => ({ ...l, items: z.array(itemShape).parse(l.items) })) as Parameters<typeof mcpBulkCreate>[1]
      const res = await mcpBulkCreate(userId, full, dryRun !== false)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

}
