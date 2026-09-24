import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, releases, templateVersions, users } from '@/shared/db'
// eslint-disable-next-line boundaries/dependencies -- право выпуска = владелец или коллаборатор, правило одно на сайт
import { isCollaborator } from '@/features/collab/queries'
import { TAG_RE, isReservedTag } from './tag-name'

/**
 * ВЫПУСК РЕЛИЗА — правила одни на две поверхности: форму на сайте и инструмент MCP.
 *
 * Здесь нет ни сессии, ни перехода: кто выпускает — передают (`userId`), что сказать
 * человеку или агенту — решает поверхность по коду отказа. Своя копия правил у агента
 * разошлась бы с формой: так уже было с двумя путями слияния (#888).
 */

/**
 * Отказ по ВВОДУ — то, что форма показывает на месте, не стирая заметки.
 * Коды отказа — значения, а не адрес `?e=`: переход стирал форму (#832).
 */
export type ReleaseRefusal = 'badtag' | 'vreserved' | 'badversion' | 'tagtaken' | 'tagfail'

export interface ReleaseInput {
  /** Версия списка; не задана — текущая. */
  version?: number
  tag: string
  title?: string
  notes?: string
  prerelease?: boolean
}

export type ReleaseOutcome =
  | { ok: true; owner: string; slug: string; version: number; tag: string }
  // `not_found` и `forbidden` — не ошибка ввода, а чужой адрес: форма о них молчит,
  // агенту нужно сказать словами.
  | { ok: false; reason: ReleaseRefusal | 'not_found' | 'forbidden' }

/** Пределы полей — одни на форму и агента: форма режет, а не отказывает. */
export const TITLE_MAX = 200
export const NOTES_MAX = 50000

async function handleOf(userId: string): Promise<string> {
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1)
  return u?.handle ?? ''
}

/** Владелец или коллаборатор выпускает релиз из версии списка. */
export async function publishRelease(userId: string, templateId: string, input: ReleaseInput): Promise<ReleaseOutcome> {
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return { ok: false, reason: 'not_found' }
  if (tpl.ownerId !== userId && !(await isCollaborator(tpl.id, userId))) return { ok: false, reason: 'forbidden' }

  const owner = await handleOf(tpl.ownerId)
  const version = input.version ?? tpl.currentVersion
  // Без дефолта `v<версия>`: такие имена зарезервированы за автотегами версий
  // (#590), пустой тег честно упадёт в badtag, а не в молчаливый отказ ядра.
  const tag = input.tag.trim()
  const title = (input.title ?? '').trim().slice(0, TITLE_MAX)
  const notes = (input.notes ?? '').trim().slice(0, NOTES_MAX)
  const prerelease = input.prerelease === true

  if (!TAG_RE.test(tag)) return { ok: false, reason: 'badtag' }
  if (isReservedTag(tag)) return { ok: false, reason: 'vreserved' }
  // Версия должна существовать. Не число («abc» из формы, дробь от агента) — сразу отказ,
  // а не запрос к базе с NaN.
  if (!Number.isInteger(version)) return { ok: false, reason: 'badversion' }
  const [v] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, tpl.id), eq(templateVersions.version, version)))
    .limit(1)
  if (!v) return { ok: false, reason: 'badversion' }
  // Тег уникален per-list.
  const [dup] = await db
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.templateId, tpl.id), eq(releases.tag, tag)))
    .limit(1)
  if (dup) return { ok: false, reason: 'tagtaken' }

  // Git-тег релиза — ДО вставки в базу: раньше сбой ядра глотался, и релиз
  // существовал без тега в git, а пользователь ничего не узнавал (#590).
  // Теперь либо есть и тег, и релиз, либо ни того ни другого — и видно почему.
  // eslint-disable-next-line boundaries/dependencies -- тег релиза ставит ядро git; иначе релиз без тега (#590)
  const { gitCore } = await import('@/features/git/core')
  try {
    await gitCore.createTag({ owner, slug: tpl.slug }, tag, version)
  } catch (err) {
    console.error(`[releases] git tag "${tag}" (v${version}) failed for ${owner}/${tpl.slug}:`, err)
    return { ok: false, reason: 'tagfail' }
  }
  await db.insert(releases).values({ templateId: tpl.id, version, tag, title, notes, prerelease, authorId: userId })
  return { ok: true, owner, slug: tpl.slug, version, tag }
}
