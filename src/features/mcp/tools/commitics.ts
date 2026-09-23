import 'server-only'
import { eq } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
import { isPubliclyVisible } from '@/core/domain/access'
import { getMcpSettings } from '@/shared/settings/mcp'
import { resolveListRefOrMoved } from './shared'
import { listRefFrom } from './resources'

/**
 * МЕТОД COMMITICS ДЛЯ СЦЕНАРИЯ — по id из настройки, а не по адресу в коде.
 *
 * Сценарий `commitics` велит агенту прочитать метод и работать по нему. Адрес метода в коде
 * был бы дырой: ник освобождается через 180 дней после смены, и занявший его человек с тем
 * же слагом подменил бы правила для каждого агента. Id не переходит к другому списку.
 *
 * Метод обязан быть виден ЛЮБОМУ: сценарий запускают чужие агенты своими токенами, и
 * закрытый метод они бы не прочитали. Предикат — общий `isPubliclyVisible`, своей копии нет.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Текущий адрес публичного списка по id — или `null`, если его нет или он закрыт. */
export async function publicListAddress(id: string): Promise<{ handle: string; slug: string } | null> {
  if (!UUID_RE.test(id)) return null
  const [row] = await db
    .select({ slug: templates.slug, handle: users.handle, visibility: templates.visibility, status: templates.status, moderation: templates.moderation })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(eq(templates.id, id))
    .limit(1)
  return row && isPubliclyVisible(row) ? { handle: row.handle, slug: row.slug } : null
}

/** Метод для сценария: адрес по настройке, `null` — не настроен или список пропал/закрыт. */
export async function commiticsMethod(): Promise<{ handle: string; slug: string } | null> {
  const { commiticsListId } = await getMcpSettings()
  return commiticsListId ? publicListAddress(commiticsListId) : null
}

/**
 * Список-метод по тому, что ввёл админ: адрес сайта, `setfork://lists/…` или «handle/slug».
 * Разбор — тот же, что у сценариев (`listRefFrom`), поиск — общим резолвером с переездами.
 */
export async function resolveMethodList(raw: string): Promise<{ id: string; handle: string; slug: string } | { error: 'notFound' | 'notPublic' }> {
  const ref = listRefFrom(raw)
  const found = ref ? await resolveListRefOrMoved(ref) : null
  if (!found) return { error: 'notFound' }
  const address = await publicListAddress(found.id)
  return address ? { id: found.id, ...address } : { error: 'notPublic' }
}
