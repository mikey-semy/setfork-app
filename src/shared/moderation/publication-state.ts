import 'server-only'
import { eq, sql } from 'drizzle-orm'
import type { ListStatus, Moderation, Visibility } from '@/core'
import { db, templates, users } from '@/shared/db'
import { getApiKey } from '@/shared/settings/ai'

/**
 * ЕДИНОЕ правило «с каким состоянием публикации список становится виден».
 *
 * Живёт в shared, а не в features/moderation, потому что потребителей два и они в
 * разных фичах: путь СОЗДАНИЯ (фасад library.listStore.create — состояние уезжает
 * в ядро значением вставки) и путь ПУБЛИКАЦИИ уже существующего списка
 * (features/moderation.gateListPublication). Копия правила во втором месте
 * разъехалась бы с первым — а это ровно то, чем платят за премодерацию: одна из
 * веток пускает непроверенное в паблик.
 */

/** Доверенный автор (Discourse-модель): кураторский аккаунт либо история
 *  без нарушений (≥3 живых публичных списков НЕ считая проверяемого, 0 flagged/hidden).
 *  В зачёт идут только СВОИ (origin='authored') списки: иначе доверие накручивалось бы
 *  форками чужих хороших списков (форкнул 3 популярных → мгновенно «доверенный»).
 *
 *  exceptListId=null — список ещё не существует (решение принимается ДО вставки),
 *  исключать нечего. */
export async function isTrustedAuthor(ownerId: string, exceptListId: string | null): Promise<boolean> {
  // Исключение проверяемого списка — отдельным условием, а не сравнением с ''/нулевым
  // uuid: при create исключать нечего, а `id <> ''` — это ошибка типа в Postgres.
  const except = exceptListId ? sql`and ${templates.id} <> ${exceptListId}` : sql``
  const [r] = await db
    .select({
      curated: users.curated,
      good: sql<number>`count(*) filter (where ${templates.moderation} = 'active' and ${templates.visibility} = 'public' and ${templates.status} = 'published' and ${templates.origin} = 'authored' ${except})::int`,
      // Нарушения считаются БЕЗ исключения проверяемого списка (как и до выноса
      // правила): уже помеченный список — это нарушение автора, а не «прочее».
      bad: sql<number>`count(*) filter (where ${templates.moderation} in ('flagged','hidden'))::int`,
    })
    .from(users)
    .leftJoin(templates, eq(templates.ownerId, users.id))
    .where(eq(users.id, ownerId))
    .groupBy(users.id, users.curated)
  if (!r) return false
  return r.curated || (r.good >= 3 && r.bad === 0)
}

/**
 * Вердикт гейта публикации для автора:
 * - `gate-off` — ИИ-ключа нет, автопроверки не существует (dev/стенды): список виден,
 *   джоба не ставится;
 * - `trusted` — автору доверяем: список виден, проверка идёт фоном;
 * - `hold` — список ждёт проверку: виден только владельцу и админу.
 */
export type PublicationDecision = 'gate-off' | 'trusted' | 'hold'

export async function publicationDecision(ownerId: string, exceptListId: string | null): Promise<PublicationDecision> {
  if (!(await getApiKey())) return 'gate-off'
  return (await isTrustedAuthor(ownerId, exceptListId)) ? 'trusted' : 'hold'
}

/**
 * Состояние публикации, с которым НОВЫЙ список должен родиться. Вызывается ДО записи:
 * состояние уезжает значением вставки в ядро, поэтому публичного окна между «строка
 * появилась» и «гейт её спрятал» не существует вовсе. Так же устроены post_status у
 * `wp_insert_post()` (WordPress) и очередь одобрения в Discourse: решение принимается
 * до появления видимого объекта, а не догоняет его отдельным шагом.
 *
 * Приватный список и черновик модерацию не проходят — наружу они не выставлены.
 */
export async function initialModeration(list: {
  ownerId: string
  visibility: Visibility
  status: ListStatus
}): Promise<Moderation> {
  if (list.visibility !== 'public' || list.status !== 'published') return 'active'
  return (await publicationDecision(list.ownerId, null)) === 'hold' ? 'pending' : 'active'
}
