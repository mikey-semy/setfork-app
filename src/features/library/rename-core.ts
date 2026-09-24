import 'server-only'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, listRedirects, templates, users } from '@/shared/db'
import { checkSlugAvailable, suggestFreeSlug } from '@/shared/lib/slug'

/**
 * СМЕНА АДРЕСА СПИСКА — правила одни на две поверхности: форму настроек и MCP.
 *
 * Прежний адрес не пропадает — он остаётся вести сюда же. Устройство взято у Gitea
 * (models/repo/redirect.go + services/repository/rename): при переименовании создаётся
 * запись «прежнее имя → список», а запись, занимавшая НОВОЕ имя, удаляется. Второе не
 * формальность: без него нельзя вернуться к прежнему имени — уникальность (владелец +
 * слаг) не пустила бы, потому что это имя уже лежит в прежних адресах этого же списка.
 *
 * Git-хранилище не трогается вовсе: репозиторий лежит по template_id (ядро, git/repo.rs),
 * а слаг списка в канон не входит — SHA коммитов остаются прежними.
 *
 * Здесь нет ни сессии, ни перехода: кто меняет — передают, что сказать — решает поверхность
 * по коду отказа. Своя копия правил у агента разошлась бы с формой.
 */
export type RenameRefusal = 'forbidden' | 'empty' | 'same' | 'invalid' | 'taken'

export type RenameOutcome =
  | { ok: true; owner: string; previous: string; slug: string }
  | { ok: false; reason: RenameRefusal; suggestion?: string }

/** Владелец меняет адрес своего списка. */
export async function renameListCore(userId: string, templateId: string, raw: string): Promise<RenameOutcome> {
  const tpl = await db.query.templates.findFirst({ where: (x) => eq(x.id, templateId) })
  if (!tpl || tpl.ownerId !== userId) return { ok: false, reason: 'forbidden' }

  const { slug, free } = await checkSlugAvailable(raw, userId, templateId)
  if (!raw.trim()) return { ok: false, reason: 'empty' }
  if (slug === tpl.slug) return { ok: false, reason: 'same' }
  // slugify никогда не возвращает пустое (фолбэк 'list'), поэтому проверяем не пустоту
  // результата, а то, что от введённого вообще что-то осталось: строка из одних знаков
  // препинания дала бы адрес 'list', о котором никто не просил.
  if (slug === 'list' && !/[a-z0-9]/i.test(raw)) return { ok: false, reason: 'invalid' }
  if (!free) {
    // Отказ без выхода: предлагаем ближайший свободный — принять его можно одним шагом.
    const suggestion = await suggestFreeSlug(raw, userId, templateId)
    return { ok: false, reason: 'taken', suggestion: suggestion ?? undefined }
  }

  const previous = tpl.slug
  await db.transaction(async (tx) => {
    // Новое имя могло раньше принадлежать этому же списку — освобождаем его.
    await tx.delete(listRedirects).where(and(eq(listRedirects.ownerId, userId), eq(listRedirects.slug, slug)))
    await tx.insert(listRedirects).values({ ownerId: userId, slug: previous, templateId })
    await tx.update(templates).set({ slug, updatedAt: new Date() }).where(eq(templates.id, templateId))
  })

  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1)
  const owner = u?.handle ?? ''
  // Прежний адрес тоже сбрасываем: его страницы теперь обязаны отвечать перенаправлением,
  // а не отдавать закешированную копию списка по старому пути. Одно на обе поверхности:
  // агент, переименовавший список, иначе оставлял бы на сайте старую копию.
  revalidatePath(`/${owner}/${previous}`, 'layout')
  revalidatePath(`/${owner}/${slug}`, 'layout')
  return { ok: true, owner, previous, slug }
}
