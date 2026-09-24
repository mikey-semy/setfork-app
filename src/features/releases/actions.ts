'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, releases, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
// eslint-disable-next-line boundaries/dependencies -- право на заметки и удаление = владелец или коллаборатор
import { isCollaborator } from '@/features/collab/queries'
import { buildReleaseChangelog } from './changelog'
import { publishRelease, type ReleaseRefusal } from './core'
import type { Lang } from '@/shared/i18n'

async function handleOf(userId: string): Promise<string> {
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1)
  return u?.handle ?? ''
}

export type { ReleaseRefusal } from './core'

/** Владелец/коллаборатор: опубликовать релиз из версии. Правила — в `core`, общие с MCP. */
export async function createRelease(
  templateId: string,
  _prev: ReleaseRefusal | null,
  formData: FormData,
): Promise<ReleaseRefusal | null> {
  const session = await requireSession()
  const version = formData.get('version')
  const res = await publishRelease(session.userId, templateId, {
    version: version == null ? undefined : Number(version),
    tag: String(formData.get('tag') ?? ''),
    title: String(formData.get('title') ?? ''),
    notes: String(formData.get('notes') ?? ''),
    prerelease: formData.get('prerelease') === 'on',
  })
  // Нет списка или нет права — молча ничего: это не ошибка ввода, а чужой адрес.
  if (!res.ok) return res.reason === 'not_found' || res.reason === 'forbidden' ? null : res.reason
  const base = `/${res.owner}/${res.slug}/releases`
  revalidatePath(base)
  redirect(base)
}

/** Автоген заметок релиза из диффа версий (для кнопки «Сгенерировать» в форме).
 *  Только владелец/коллаборатор; пусто — сравнивать не с чем или без изменений. */
export async function generateReleaseNotes(templateId: string, toVersion: number, lang: Lang): Promise<string> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return ''
  const canManage = tpl.ownerId === session.userId || (await isCollaborator(templateId, session.userId))
  if (!canManage) return ''
  return buildReleaseChangelog(templateId, toVersion, lang)
}

/** Владелец/коллаборатор: удалить релиз (сам список/версии не трогаем). */
export async function deleteRelease(releaseId: string): Promise<void> {
  const session = await requireSession()
  const rel = await db.query.releases.findFirst({ where: (r) => eq(r.id, releaseId) })
  if (!rel) return
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, rel.templateId) })
  if (!tpl) return
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return
  await db.delete(releases).where(eq(releases.id, releaseId))
  const owner = await handleOf(tpl.ownerId)
  revalidatePath(`/${owner}/${tpl.slug}/releases`)
}
