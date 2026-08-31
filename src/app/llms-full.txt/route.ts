import { desc, eq } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
import { indexableFilter } from '@/features/library/queries/shared'
// Список УЖЕ отобран `indexableFilter` (публичный + опубликованный + прошёл модерацию
// + не порода), то есть гейт видимости пройден запросом выше. `requireViewableDetail`
// здесь неприменим: он спрашивает сессию, а этот файл читают машины без неё.
// eslint-disable-next-line no-restricted-imports -- см. абзац выше
import { getTemplateDetail } from '@/features/library/queries'
import { toExportList, toMarkdown } from '@/features/library/export'
import { LLMS_INLINED } from '@/shared/seo/llms'
import { SITE_ORIGIN } from '@/shared/site'

/**
 * `/llms-full.txt` — те же списки, что в `llms.txt`, но С СОДЕРЖИМЫМ.
 *
 * Указатель отвечает на вопрос «что здесь есть», этот файл — «что именно написано»:
 * модель, которой нужен готовый ответ, а не обход сайта, читает его целиком.
 *
 * ⚠️ ОДИН РЕНДЕРЕР. Содержимое собирается тем же `toMarkdown`, что отдаёт экспорт
 * списка: второй вариант markdown у нас не появляется. Разойдись они — и агент,
 * прочитавший список здесь, получил бы не то, что скачал бы по ссылке.
 *
 * ⚠️ ТО ЖЕ ПРАВИЛО ИНДЕКСАЦИИ, что у карты сайта: порода не предлагается. Прямая
 * ссылка на `.md` при этом работает для любого видимого списка — экспорт не индексация,
 * это то же разведение, что видимость/индексация у решения 0018.
 */
// ⚠️ ДИНАМИЧЕСКИЙ, НО КЕШИРУЕМЫЙ — и это не полумера, а единственная рабочая форма.
//
// Первой попыткой здесь стоял `revalidate = 3600`: тогда Next ПРЕРЕНДЕРИТ маршрут на
// сборке, а базы на сборке нет — `npm run build` упал с ECONNREFUSED. Поймано сборкой,
// не тестами: юниты при этом были зелёными.
//
// Задача была в цене, а не в способе: маршрут без авторизации, который сам себя
// рекламирует обходчикам в `llms.txt`, не должен стоить полного обхода базы на каждое
// обращение. Это решает кеш ответа ниже (`s-maxage`), а не пререндер.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const rows = await db
    .select({ handle: users.handle, slug: templates.slug })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(indexableFilter())
    .orderBy(desc(templates.starsCount), desc(templates.updatedAt))
    .limit(LLMS_INLINED)

  const parts: string[] = [
    '# SetFork — full content of the top lists',
    '',
    '> Each list below is a VERSION: a fixed set of bytes. Editing a list creates the next version,',
    '> so quote `owner/slug@version` if you need to point at exactly what you read.',
    `> Full index: ${SITE_ORIGIN}/llms.txt`,
    '',
  ]

  // ⚠️ ОДНОЙ ВОЛНОЙ, а не по очереди. Каждый `getTemplateDetail` — это несколько запросов
  // плюс подготовка аватара; двадцать списков подряд давали около шестидесяти
  // последовательных обращений на один ответ. Порядок вывода сохраняется — он берётся из
  // `rows`, а не из того, кто ответил первым.
  const details = await Promise.all(rows.map((r) => getTemplateDetail(r.handle, r.slug)))
  for (const [i, detail] of details.entries()) {
    if (!detail) continue
    const r = rows[i]
    parts.push(`---`, '', `Source: ${SITE_ORIGIN}/${r.handle}/${r.slug}`, '', toMarkdown(toExportList(detail), 'en'), '')
  }

  return new Response(parts.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // Час у общего кеша: корпус меняется медленнее, а адресат — обходчик, которому
      // свежесть в минутах не нужна. `stale-while-revalidate` снимает всплеск при
      // истечении: первый пришедший получает прежний ответ, пока собирается новый.
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
    },
  })
}
