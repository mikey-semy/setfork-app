/**
 * ОБНУЛЯЕТ ВИСЯЧИЕ ССЫЛКИ «форк от кого».
 *
 * Зачем. У `templates.forked_from_id` до 27.08.2026 не было внешнего ключа: ссылка на
 * удалённый список просто ложилась в базу и оставалась висеть. Ключ (`set null`) заведён
 * той же датой, но ВСТАТЬ ОН НЕ МОЖЕТ, пока в таблице есть хоть одна висячая строка —
 * `db:push` на ней падает. Значит порядок выкатки строгий:
 *
 *     npx tsx scripts/fix-dangling-forks.ts     # сначала данные
 *     npm run db:push                           # потом ограничение
 *
 * Без первого шага падает второй, и падает он на выкатке, а не здесь.
 *
 * Что делает. Ровно одно: там, где `forked_from_id` указывает на несуществующий список,
 * ставит NULL. Списки НЕ удаляет и ничего больше не трогает. Это то же самое, что сделал
 * бы сам ключ при удалении родителя, — просто задним числом, за все разы, когда ключа
 * ещё не было.
 *
 * Почему обнулить, а не удалить. Форк — работа другого человека. Родителя у него больше
 * нет, а сам он существует и кому-то принадлежит; удалять чужой список ради того, чтобы
 * поставить ограничение, несоразмерно. Теряется родословная, а не список.
 *
 * Замер прода 27.08.2026: форков всего один, и он уже был висячим. Появился он не от
 * удаления учётки (тот путь ни разу не исполнялся), а от обычного УДАЛЕНИЯ СПИСКА —
 * пункта Danger Zone. Заметить порчу было нечем: интерфейс `forked_from_id` не читает
 * вовсе, а дерево форков строится сверху вниз, поэтому висячий форк не попадает ни в
 * одно дерево. У расхождения между слоем базы и слоем отображения не было наблюдателя.
 *
 * Идемпотентен: второй запуск найдёт ноль строк и ничего не сделает.
 */
import { isNotNull, sql } from 'drizzle-orm'
import { db, templates } from '@/shared/db'

async function main() {
  const dangling = await db
    .select({ id: templates.id, slug: templates.slug, parent: templates.forkedFromId })
    .from(templates)
    .where(
      sql`${templates.forkedFromId} is not null and not exists (
        select 1 from ${templates} parent where parent.id = ${templates.forkedFromId}
      )`,
    )

  const total = await db.select({ n: sql<number>`count(*)::int` }).from(templates).where(isNotNull(templates.forkedFromId))

  console.log(`форков всего: ${total[0]?.n ?? 0}`)
  console.log(`из них висячих: ${dangling.length}`)

  if (dangling.length === 0) {
    console.log('чинить нечего — можно ставить ограничение')
    return
  }

  // Показываем ПОИМЁННО до того, как трогаем: правка живых данных, и человек, который
  // её запускает, обязан видеть, что именно изменится, а не только сколько строк.
  for (const r of dangling) console.log(`  ${r.slug} (${r.id}) → родитель ${r.parent} не существует`)

  const ids = dangling.map((r) => r.id)
  const done = await db
    .update(templates)
    .set({ forkedFromId: null })
    .where(sql`${templates.id} in ${ids}`)
    .returning({ id: templates.id })

  console.log(`обнулено: ${done.length}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
