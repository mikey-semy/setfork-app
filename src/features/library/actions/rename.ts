'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, listRedirects, templates } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { checkSlugAvailable } from '@/shared/lib/slug'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'

export type RenameResult = { error?: string }

/**
 * Сменить адрес списка. Прежний адрес не пропадает — он остаётся вести сюда же.
 *
 * Устройство взято у Gitea (models/repo/redirect.go + services/repository/rename):
 * при переименовании создаётся запись «прежнее имя → репозиторий», а запись, занимавшая
 * НОВОЕ имя, удаляется. Второе не формальность: без него нельзя вернуться к прежнему
 * имени — уникальность (владелец + слаг) не пустила бы, потому что это имя уже лежит
 * в прежних адресах этого же списка.
 *
 * Почему адрес не следует за заголовком автоматически: заголовок правят часто — опечатка,
 * уточнение, перевод, — и адрес прыгал бы от каждой мелочи, меняя git remote у всех, кто
 * клонировал, без ведома людей. Поэтому переименование — отдельное осознанное действие,
 * как и в Gitea/GitHub, и живёт в опасной зоне.
 *
 * Git-хранилище не трогается вовсе: репозиторий лежит по template_id (ядро,
 * git/repo.rs), а слаг списка в канон не входит — SHA коммитов остаются прежними.
 */
export async function renameList(
  templateId: string,
  _prev: RenameResult | null,
  formData: FormData,
): Promise<RenameResult> {
  // Независимые чтения — параллельно: язык ответа и личность друг от друга не зависят.
  const [lang, session] = await Promise.all([getLang(), requireSession()])
  const tpl = await db.query.templates.findFirst({ where: (x) => eq(x.id, templateId) })
  // Молча выходим ровно как соседние действия зоны: чужой список — не наше дело.
  if (!tpl || tpl.ownerId !== session.userId) return { error: t('renameNotAllowed', lang) }

  const raw = String(formData.get('slug') ?? '')
  const { slug, free } = await checkSlugAvailable(raw, session.userId, templateId)
  if (!raw.trim()) return { error: t('renameEmpty', lang) }
  if (slug === tpl.slug) return { error: t('renameSame', lang) }
  // slugify никогда не возвращает пустое (фолбэк 'list'), поэтому проверяем не пустоту
  // результата, а то, что от введённого вообще что-то осталось: строка из одних знаков
  // препинания дала бы адрес 'list', о котором человек не просил.
  if (slug === 'list' && !/[a-z0-9]/i.test(raw)) return { error: t('renameInvalid', lang) }
  if (!free) return { error: t('renameTaken', lang) }

  const previous = tpl.slug
  await db.transaction(async (tx) => {
    // Новое имя могло раньше принадлежать этому же списку — освобождаем его.
    await tx
      .delete(listRedirects)
      .where(and(eq(listRedirects.ownerId, session.userId), eq(listRedirects.slug, slug)))
    await tx.insert(listRedirects).values({ ownerId: session.userId, slug: previous, templateId })
    await tx.update(templates).set({ slug, updatedAt: new Date() }).where(eq(templates.id, templateId))
  })

  // Прежний адрес тоже сбрасываем: его страницы теперь обязаны отвечать перенаправлением,
  // а не отдавать закешированную копию списка по старому пути.
  revalidatePath(`/${session.handle}/${previous}`, 'layout')
  revalidatePath(`/${session.handle}/${slug}`, 'layout')
  redirect(`/${session.handle}/${slug}/settings`)
}
