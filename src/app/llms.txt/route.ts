import { desc, eq } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
import { indexableFilter } from '@/features/library/queries/shared'
import { LLMS_INLINED, LLMS_LISTED } from '@/shared/seo/llms'
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

/**
 * Текст автора — в ОДНУ строку, без разметки и заданной длины.
 *
 * ⚠️ ДВЕ ДОРОГИ К ПОДДЕЛКЕ, и закрыть надо обе. Файл агенты читают как заявление сайта
 * о себе, а название и описание правит автор.
 *
 * Первая — ПЕРЕНОС СТРОКИ: формат строчный, и `\n` внутри описания разрывал запись
 * надвое, а второй кусок читался как отдельный пункт списка.
 *
 * Вторая — РАЗМЕТКА, и она хуже. Название вставляется внутрь `[...]`, поэтому заголовок
 * вида `Мой список](https://evil.example/phish` даёт строку
 * `- [Мой список](https://evil.example/phish](https://setfork.com/u/slug)`: разбирающий
 * markdown агент увидит ссылку на ЧУЖОЙ домен, подписанную нашим названием. Проверено в
 * узле до правки. Описание опаснее меньше (оно после `: `), но дорога та же — вставить
 * туда `[фейк](evil)`.
 *
 * Поэтому вырезаем `[`, `]`, `(`, `)` и обратный слеш: в подписи они не несут смысла, а
 * ссылку в этом формате строит только сам файл.
 */
function oneLine(text: string, max: number): string {
  return text
    .replace(/[[\]()\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

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
    .limit(LLMS_LISTED)

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
      // ⚠️ ОДНА СТРОКА НА СПИСОК — И ЭТО НАДО ОБЕСПЕЧИТЬ, а не предположить. Формат
      // строчный, а название и описание правит автор: описание приходит из многострочного
      // поля, и перевод строки внутри него ломает секцию `## Lists`, позволяя дописать в
      // неё поддельную запись. Файл агенты читают как ЗАЯВЛЕНИЕ СЕТФОРКА о себе, поэтому
      // цена подделки здесь выше обычной опечатки.
      const title = oneLine(tr(r.title, 'en') || r.slug, 120)
      const desc = oneLine(tr(r.desc, 'en'), 200)
      return `- [${title}](${SITE_ORIGIN}/${r.handle}/${r.slug})${desc ? `: ${desc}` : ''}`
    }),
    '',
    `## Full index`,
    '',
    `- [llms-full.txt](${SITE_ORIGIN}/llms-full.txt): the first ${LLMS_INLINED} of these lists with their steps inlined`,
    `- [sitemap.xml](${SITE_ORIGIN}/sitemap.xml): every indexable address`,
    '',
  ]

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  })
}
