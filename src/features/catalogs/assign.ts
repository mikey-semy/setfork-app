import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, repositories, templates } from '@/shared/db'

/**
 * ПОЛОЖИТЬ СПИСОК НА ПОЛКУ ПО ИМЕНИ — одно правило на все входы.
 *
 * Входов уже три: форма создания, создание через MCP и создание пачкой через MCP. Правило
 * у них одно, а разъезжается такая тройка всегда одинаково — где-то забывают проверку.
 * Проверок здесь две, и обе обязательны:
 *
 *  - ПОЛКА СВОЯ. Имя приходит снаружи (браузер, ассистент) и само по себе ничего не значит:
 *    ищем среди полок этого владельца, иначе чужая полка приняла бы чужой список.
 *  - ЗАМОК. Поиск и запись идут одной транзакцией с тем же замком, что берёт удаление
 *    полки: порознь её успевают удалить между «нашли» и «записали», а внешнего ключа у
 *    `repositoryId` нет — список остался бы указывать на исчезнувшую, пропав разом из всех
 *    фильтров. Это находка авто-ревью, повторённая на трёх разных путях подряд.
 *
 * Не нашлось — список просто остаётся без полки. Ронять из-за этого создание нельзя: список
 * уже написан, и полка тут не главное.
 */
export async function assignCatalogByName(listId: string, ownerId: string, rawName: string | null | undefined): Promise<boolean> {
  const name = String(rawName ?? '').trim()
  if (!name) return false
  return db.transaction(async (tx) => {
    const [cat] = await tx
      .select({ id: repositories.id })
      .from(repositories)
      .where(and(eq(repositories.ownerId, ownerId), eq(repositories.name, name)))
      .limit(1)
      .for('update')
    if (!cat) return false
    await tx.update(templates).set({ repositoryId: cat.id }).where(eq(templates.id, listId))
    return true
  })
}
