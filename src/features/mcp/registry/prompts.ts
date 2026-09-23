import { z } from 'zod'
import { listUri, mcpListMarkdown, parseListRef } from '../tools/resources'
import { userIdOf, type Extra, type McpServer } from './kit'

/**
 * СЦЕНАРИИ MCP (prompts): готовые последовательности из УЖЕ существующих инструментов.
 * Клиенты показывают их слэш-командами (в Claude Code — `/mcp__setfork__<имя>`).
 *
 * Новых инструментов сценарии не вводят: это слова, которые агент получает вместо того,
 * чтобы угадывать порядок вызовов. Текст английский, как у всей поверхности MCP.
 *
 * «Копай глубже» сюда намеренно НЕ входит: у общей шахты (`dig_layers`) нет инструмента MCP,
 * а сценарий в обход шахты выкапывал бы слои, которых больше никто не увидит.
 */

/** Метод разбора ошибки лежит у нас же списком — сценарий читает его, а не пересказывает. */
const COMMITICS_METHOD = { handle: 'miki', slug: 'kak-razobrat-chuzhuyu-oshibku-metod-kommitsov' }

const user = (text: string) => ({ role: 'user' as const, content: { type: 'text' as const, text } })

/**
 * Список ресурсом прямо в сообщении — тогда агенту не нужен лишний `get_list`. Доступ тот
 * же, что у ресурса: недоступный или неразобранный адрес — просто без вложения, агент
 * найдёт список сам.
 */
async function attachList(raw: string, extra: Extra) {
  const ref = parseListRef(raw)
  const userId = userIdOf(extra)
  if (!ref || !userId) return []
  const text = await mcpListMarkdown(userId, ref.handle, ref.slug)
  if (text === null) return []
  return [
    {
      role: 'user' as const,
      content: { type: 'resource' as const, resource: { uri: listUri(ref.handle, ref.slug), mimeType: 'text/markdown', text } },
    },
  ]
}

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    'run-list',
    {
      title: 'Run a list',
      description: 'Execute a SetFork list step by step and record an honest run report.',
      argsSchema: { list: z.string().describe('The list: "handle/slug" or its web address') },
    },
    async ({ list }, extra) => ({
      messages: [
        user(
          [
            `Run the SetFork list ${list} and record what actually happened.`,
            '',
            '1. Read it with get_list (skip this if the list is attached below) and note its "version".',
            '2. start_run for it — this creates the run your evidence belongs to.',
            '3. Go through the steps in order. For EACH step call check_step with the run id and the step number:',
            '   - done:true when you did it and saw it work — say what you observed;',
            '   - blocked:true with a reason when it failed or could not be done.',
            '   A step you cannot verify (no access, needs a human, needs hardware) is reported as such — never skipped silently and never marked done on trust.',
            '4. Finish with report_run: name exactly what was verified, and give every step its status (pass / fail / skip) with a short note.',
            '',
            'Do not change the list itself while running it; if a step is wrong, say so in the report.',
          ].join('\n'),
        ),
        ...(await attachList(list, extra as Extra)),
      ],
    }),
  )

  server.registerPrompt(
    'review-list',
    {
      title: 'Review a list with a gnome',
      description: 'Ask a SetFork gnome expert to review a list; the result is a list of remarks tied to block ids.',
      argsSchema: {
        list: z.string().describe('The list: "handle/slug" or its web address'),
        gnome: z.string().optional().describe('Gnome id from list_gnomes; omit to let the topic pick the expert'),
      },
    },
    async ({ list, gnome }) => ({
      messages: [
        user(
          [
            `Review the SetFork list ${list} with a gnome expert.`,
            '',
            gnome
              ? `1. Call gnome_review for this list with gnome "${gnome}".`
              : '1. Call gnome_review for this list without "gnome" — the expert is matched by the list topic (list_gnomes shows who is available).',
            '2. Report the result as a list of remarks. Each remark names the block it is about by its "bid" (get_list returns them), says what is wrong and what to change.',
            '3. Keep the expert\'s remarks separate from your own opinion, and do not edit the list — this is a review, not a rewrite.',
          ].join('\n'),
        ),
      ],
    }),
  )

  server.registerPrompt(
    'commitics',
    {
      title: 'Break down a bug story (Commitics)',
      description: 'Break down a real bug story from an issue, PR or commit by the Commitics method; the result is a private draft list.',
      argsSchema: { url: z.string().describe('An issue, pull request or commit URL') },
    },
    async ({ url }) => ({
      messages: [
        user(
          [
            `Break down ${url} by the Commitics method.`,
            '',
            `1. Read the method first: get_list handle "${COMMITICS_METHOD.handle}", slug "${COMMITICS_METHOD.slug}". Follow its rules: exact quotes with links, dates, links pinned to a commit SHA, no guessing at people's motives.`,
            '2. Dig into the history behind the link — the change, the discussion around it, what came before and after — and find the chain: what was done, what went wrong, how it was fixed, and how people explained it.',
            '3. If there is no such chain, stop and say so instead of stretching the story.',
            '4. Save the result with create_list — it is created as a PRIVATE DRAFT. Frames of the story are "text" blocks, the checks for our own code are "step" blocks, links go in "refs". Do not publish it.',
          ].join('\n'),
        ),
      ],
    }),
  )
}
