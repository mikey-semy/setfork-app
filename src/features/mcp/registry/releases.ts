import { z } from 'zod'
import { mcpCreateRelease, mcpListReleases } from '@/features/mcp/tools'
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
      title: 'Publish a release of a list',
      description:
        'Publish a release from a version of a list — the owner or a collaborator. Creates a git tag at that version and a release entry with a title and Markdown notes; it is public right away (there are no draft releases). Tags "v" + digits only (v3) are reserved for automatic version tags — use "1.2.0" or "v1.2.0". With generateNotes the notes get the step-level diff since the previous release appended under your own text. A taken tag is refused, not overwritten.',
      inputSchema: {
        list,
        tag: z.string().describe('Release tag, e.g. "v1.2.0" — letters, digits, ".-_", up to 40 characters'),
        version: z.number().int().min(1).optional().describe('List version to release (default: the current one, as get_list shows it)'),
        title: z.string().max(200).optional().describe('Release title — one line: what this release is'),
        notes: z.string().max(50000).optional().describe('Release notes in Markdown: what changed and why it matters'),
        prerelease: z.boolean().optional().describe('Mark as a pre-release: shown, but never labelled "latest"'),
        generateNotes: z.boolean().optional().describe('Append the step diff since the previous release (Added / Changed / Removed / Moved) under your notes'),
        notesLang: z.enum(['en', 'ru']).optional().describe('Language of the generated section headings (default "en")'),
      },
    },
    async (userId, args) => {
      const res = await mcpCreateRelease(userId, args)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )
}
