'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, releases, templates, templateVersions, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { isCollaborator } from '@/features/collab/queries'
import { buildReleaseChangelog } from './changelog'
import { TAG_RE, isReservedTag } from './tag-name'
import type { Lang } from '@/shared/i18n'

async function handleOf(userId: string): Promise<string> {
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1)
  return u?.handle ?? ''
}

/**
 * Коды отказа на выпуске релиза. Возвращаются ЗНАЧЕНИЕМ, а не адресом `?e=`.
 *
 * Переход начинал новый GET и стирал форму, а в ней самое дорогое — заметки релиза,
 * которые человек мог только что СГЕНЕРИРОВАТЬ (вызов ИИ стоит денег и минуты). Ошибся
 * в теге — плати ещё раз. Тот же корень, что у формы создания списка (#832).
 */
export type ReleaseRefusal = 'badtag' | 'vreserved' | 'badversion' | 'tagtaken' | 'tagfail'

/** Владелец/коллаборатор: опубликовать релиз из версии. */
export async function createRelease(
  templateId: string,
  _prev: ReleaseRefusal | null,
  formData: FormData,
): Promise<ReleaseRefusal | null> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  // Нет списка или нет права — молча ничего: это не ошибка ввода, а чужой адрес.
  if (!tpl) return null
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return null

  const owner = await handleOf(tpl.ownerId)
  const base = `/${owner}/${tpl.slug}/releases`
  const version = Number(formData.get('version') ?? tpl.currentVersion)
  // Без дефолта `v<версия>`: такие имена зарезервированы за автотегами версий
  // (#590), пустой тег честно упадёт в badtag, а не в молчаливый отказ ядра.
  const tag = String(formData.get('tag') ?? '').trim()
  const title = String(formData.get('title') ?? '').trim().slice(0, 200)
  const notes = String(formData.get('notes') ?? '').trim().slice(0, 50000)
  const prerelease = formData.get('prerelease') === 'on'

  if (!TAG_RE.test(tag)) return 'badtag'
  if (isReservedTag(tag)) return 'vreserved'
  // Версия должна существовать.
  const [v] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, tpl.id), eq(templateVersions.version, version)))
    .limit(1)
  if (!v) return 'badversion'
  // Тег уникален per-list.
  const [dup] = await db
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.templateId, tpl.id), eq(releases.tag, tag)))
    .limit(1)
  if (dup) return 'tagtaken'

  // Git-тег релиза — ДО вставки в базу: раньше сбой ядра глотался, и релиз
  // существовал без тега в git, а пользователь ничего не узнавал (#590).
  // Теперь либо есть и тег, и релиз, либо ни того ни другого — и видно почему.
  const { gitCore } = await import('@/features/git/core')
  try {
    await gitCore.createTag({ owner, slug: tpl.slug }, tag, version)
  } catch (err) {
    console.error(`[releases] git tag "${tag}" (v${version}) failed for ${owner}/${tpl.slug}:`, err)
    return 'tagfail'
  }
  await db.insert(releases).values({ templateId: tpl.id, version, tag, title, notes, prerelease, authorId: session.userId })
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
