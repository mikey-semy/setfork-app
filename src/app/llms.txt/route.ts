import { desc, eq } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
import { indexableFilter } from '@/features/library/queries/shared'
import { SITE_ORIGIN } from '@/shared/site'
import { tr } from '@/shared/i18n'

/**
 * `/llms.txt` — КАРТА САЙТА ДЛЯ ЯЗЫКОВОЙ МОДЕЛИ (соглашение llmstxt.org).
 *
 * Отличие от `sitemap.xml` не в формате, а в адресате. Карта сайта говорит обходчику
 * «вот адреса, обойди»; этот файл говорит модели «вот что здесь есть и как этим
 * пользоваться» — коротко, в markdown, с осмысленными подписями. Модель, которой дали
 * ссылку на сайт, читает его первым и решает, куда идти дальше.
 *
 * ⚠️ ПИШЕМ ТО, ЧТО ОТЛИЧАЕТ НАС, А НЕ ПОХВАЛЫ. У списка есть версия (байты, не ветка),
 * правка создаёт новую, у версии бывает отчёт о прогоне. Это факты, меняющие поведение
 * читателя: без них он будет считать ссылку `owner/slug` неподвижной.
 *
 * ⚠️ `force-dynamic`, как у sitemap: файл читает живой корпус, а не тот, что был на
 * момент сборки образа. С `revalidate` роут считается пререндеримым, и сборка в CI
 * падает на попытке сходить в базу, которой там нет.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Сколько списков перечислять: файл — указатель, а не выгрузка корпуса. */
const LISTED = 50

export async function GET() {
  // ТО ЖЕ правило, что у карты сайта: порода не рекламируется агентам. Иначе карта
  // прячет непроверенное, а этот файл его предлагает — ровно тем читателям, ради
  // доверия которых уровни и заведены.
  const rows = await db
    .select({
      handle: users.handle,
      slug: templates.slug,
      title: templates.title,
      desc: templates.desc,
      stars: templates.starsCount,
    })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(indexableFilter())
    .orderBy(desc(templates.starsCount), desc(templates.updatedAt))
    .limit(LISTED)

  const lines = [
    '# SetFork',
    '',
    '> Runnable, versioned checklists. A list is a sequence of blocks (steps, text, polls, quizzes).',
    '> Every edit creates a new VERSION — a fixed set of bytes, not a moving branch — so `owner/slug@version`',
    '> identifies exactly what you read. A version may carry a run report: evidence that it was actually executed.',
    '',
    '## How to use this site',
    '',
    `- [Explore](${SITE_ORIGIN}/explore): browse lists by topic`,
    `- [Search](${SITE_ORIGIN}/search): full-text and qualifier search (\`by:\`, \`tag:\`, \`type:\`)`,
    '- Any list is available as markdown: append `.md` to its address',
    '- MCP server at `/api/mcp`: read lists, propose edits, record run reports',
    '',
    '## Lists',
    '',
    ...rows.map((r) => {
      const title = tr(r.title, 'en') || r.slug
      const desc = tr(r.desc, 'en')
      return `- [${title}](${SITE_ORIGIN}/${r.handle}/${r.slug})${desc ? `: ${desc}` : ''}`
    }),
    '',
    `## Full index`,
    '',
    `- [llms-full.txt](${SITE_ORIGIN}/llms-full.txt): the same lists with their steps inlined`,
    `- [sitemap.xml](${SITE_ORIGIN}/sitemap.xml): every indexable address`,
    '',
  ]

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  })
}
