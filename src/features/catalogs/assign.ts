import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, repositories, templates } from '@/shared/db'
import { slugify } from '@/shared/lib/slugify'

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
    const mine = await tx
      .select({ id: repositories.id, name: repositories.name, title: repositories.title })
      .from(repositories)
      .where(eq(repositories.ownerId, ownerId))
      .for('update')
    const cat = matchCatalog(mine, name)
    if (!cat) return false
    await tx.update(templates).set({ repositoryId: cat.id }).where(eq(templates.id, listId))
    return true
  })
}

/**
 * Найти полку по тому, что человек (или ассистент) считает её именем.
 *
 * Имён у полки на деле два: техническое (`name`, слаг) и видимое (`title`, на языке
 * автора). В интерфейсе всегда показано ВТОРОЕ — значит именно его и назовут. Требовать
 * слаг и отвечать «нет такой» на «Скиллы» — это переложить на человека знание о внутреннем
 * устройстве (находка авто-ревью: у ассистента и вовсе не было способа узнать слаг).
 *
 * Порядок разбора от точного к терпимому: слаг → тот же текст, приведённый к слагу →
 * видимый заголовок без учёта регистра. Двусмысленность НЕ разрешаем: если под заголовок
 * подходят две полки, честнее не выбрать никакую, чем угадать.
 */
export function matchCatalog<T extends { name: string; title: unknown }>(mine: T[], wanted: string): T | null {
  const exact = mine.find((c) => c.name === wanted)
  if (exact) return exact
  const asSlug = slugify(wanted)
  const bySlug = mine.find((c) => c.name === asSlug)
  if (bySlug) return bySlug
  const needle = wanted.toLowerCase()
  const byTitle = mine.filter((c) => Object.values((c.title ?? {}) as Record<string, string>).some((v) => v?.trim().toLowerCase() === needle))
  return byTitle.length === 1 ? byTitle[0] : null
}
