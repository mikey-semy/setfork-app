/**
 * Golden-set eval retrieval (P7 анализа поиска, HQ research/2026-07-22):
 * КАЧЕСТВО поиска на ЖИВОЙ базе с настоящими эмбеддингами — recall@3 и MRR.
 * Без него улучшения поиска — вера, а не инженерия.
 *
 * Запуск (нужны DATABASE_URL и ключи эмбеддинг-провайдера в окружении):
 *   npx tsx scripts/eval-retrieval.ts
 *
 * Набор пополняется по мере роста корпуса: пары «запрос → слаг списка,
 * который ОБЯЗАН быть в топ-3». Держи запросы разноплановыми: точный термин,
 * перефраз, опечатка домена, EN/RU.
 */
import { eq } from 'drizzle-orm'
import { db, templates } from '../src/shared/db'
import { findPrecedents } from '../src/shared/ai/retrieval'

const GOLDEN: { query: string; expectSlug: string }[] = [
  // Дополнять при росте корпуса — прод-слаги из библиотеки.
  { query: 'как сделать маршмеллоу дома', expectSlug: '-' },
  { query: 'домашний зефир рецепт', expectSlug: '-' },
  { query: 'книги про гномов почитать', expectSlug: 'knigi-pro-gnomov' },
  { query: 'научная фантастика что читать', expectSlug: 'spisok-knig-po-nauchnoy-fantastike-dlya-chteniya' },
]

async function main() {
  let hits = 0
  let mrrSum = 0
  for (const g of GOLDEN) {
    const [tpl] = await db.select({ title: templates.title }).from(templates).where(eq(templates.slug, g.expectSlug))
    if (!tpl) {
      console.log(`SKIP  «${g.query}» — слага ${g.expectSlug} нет в базе`)
      continue
    }
    const expected = Object.values(tpl.title as Record<string, string>).filter(Boolean)
    const r = await findPrecedents(g.query, 'ru', { limit: 3 })
    const rank = r.lists.findIndex((l) => expected.includes(l.title)) + 1
    if (rank > 0) {
      hits++
      mrrSum += 1 / rank
      console.log(`HIT@${rank}  «${g.query}» → ${r.lists[rank - 1].title}`)
    } else {
      console.log(`MISS  «${g.query}» → [${r.lists.map((l) => l.title).join(' | ')}]`)
    }
  }
  const n = GOLDEN.length
  console.log(`\nrecall@3 = ${hits}/${n} (${((hits / n) * 100).toFixed(0)}%), MRR = ${(mrrSum / n).toFixed(3)}`)
  process.exit(0)
}

void main()
