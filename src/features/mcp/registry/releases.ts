import { z } from 'zod'
import { mcpCreateRelease, mcpListReleases } from '@/features/mcp/tools'
import { RELEASE_NOTES_MAX, RELEASE_TITLE_MAX } from '@/features/releases/tag-name'
import { json, err, type ToolKit } from './kit'

/**
 * Релизы: выпустить из версии списка и прочитать выпущенные.
 *
 * Релиз — это человеческое имя версии («1.2.0» вместо «v7») с заметками Markdown и
 * git-тегом. У формы на сайте те же правила (`features/releases/core`); агенту
 * инструмент нужен ради заметок — он знает, что вошло в версию, а набирать это
 * в поле формы некому.
 */
const list = z.string().describe('List reference: "handle/slug" or just "slug"')

export function registerReleases({ readTool, writeTool }: ToolKit) {
  readTool(
    'list_releases',
    {
      title: 'List releases of a list',
      description:
        'Releases of one list, newest first: tag, the list version it points at, title, Markdown notes, prerelease flag and which one is the latest (the newest non-prerelease). Use it before create_release to pick the next tag and to see what the previous notes looked like.',
      inputSchema: {
        list,
        limit: z.number().int().min(1).max(50).optional().describe('Releases per page (default 10)'),
        page: z.number().int().min(1).max(1000).optional().describe('Page number (default 1); the answer carries nextPage while there are more'),
      },
    },
    async (userId, args) => {
      const res = await mcpListReleases(userId, args)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  writeTool(
    'create_release',
    {
      // Чужого не стирает и не заменяет (занятый тег — отказ, а не перенос), поэтому НЕ
      // разрушающий в смысле перечня в registry.test.ts. Но необратим НАРУЖУ: тег уходит
      // в зеркала списка, а удаление релиза на сайте его не снимает. Отсюда два шага (как
      // publish_draft) и openWorldHint — запись выходит за пределы SetFork.
      annotations: { openWorldHint: true },
      title: 'Publish a release of a list',
      description:
        'Publish a release from a version of a list — the owner or a collaborator. TWO STEPS: without confirm it only reports what would be published; with confirm:true it creates a git tag at that version (it also goes to the list mirrors, and deleting the release on the site does not remove the tag) and a release entry with a title and Markdown notes, visible to whoever can see the list. Tags "v" + digits only (v3) are reserved for automatic version tags — use "1.2.0" or "v1.2.0". A tag already used by a release, or a git tag with that name on another version, is refused, never moved. generateNotes appends a step diff under your notes: against the version of the previous release, or — for the first release — against the version just below. The answer returns the notes exactly as saved.',
      inputSchema: {
        list,
        tag: z.string().describe('Release tag, e.g. "v1.2.0" — letters, digits, ".-_", up to 40 characters; not starting with "-", not ending with "."'),
        version: z.number().int().min(1).optional().describe('List version to release (default: the current one, as get_list shows it)'),
        title: z.string().max(RELEASE_TITLE_MAX).optional().describe('Release title — one line: what this release is'),
        notes: z.string().max(RELEASE_NOTES_MAX).optional().describe('Release notes in Markdown: what changed and why it matters'),
        prerelease: z.boolean().optional().describe('Mark as a pre-release: shown, but never labelled "latest"'),
        generateNotes: z.boolean().optional().describe('Append the step diff (Added / Changed / Removed / Moved) under your notes'),
        notesLang: z
          .enum(['en', 'ru'])
          .optional()
          .describe('Language of the generated part — headings AND step titles, compared in this language (default "en")'),
        confirm: z.boolean().optional().describe('true = publish; omitted = only report what would be published'),
      },
    },
    async (userId, args) => {
      const res = await mcpCreateRelease(userId, args)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )
}
