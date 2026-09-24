import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { BranchOpError, canEditList, canViewList } from '@/core'
import { db, releases, templateVersions, users } from '@/shared/db'
// eslint-disable-next-line boundaries/dependencies -- право выпуска = владелец или коллаборатор, правило одно на сайт
import { isCollaborator } from '@/features/collab/queries'
import type { Lang } from '@/shared/i18n'
import { buildReleaseChangelog } from './changelog'
import { RELEASE_NOTES_MAX, RELEASE_TITLE_MAX, isReservedTag, isValidTag } from './tag-name'

/**
 * ВЫПУСК РЕЛИЗА — правила одни на две поверхности: форму на сайте и инструмент MCP.
 *
 * Здесь нет ни сессии, ни перехода: кто выпускает — передают (`userId`), что сказать
 * человеку или агенту — решает поверхность по коду отказа. Своя копия правил у агента
 * разошлась бы с формой: так уже было с двумя путями слияния (#888). Поэтому здесь ВСЁ:
 * видимость, право, архив, имя, версия, занятость тега — и сборка заметок, которая идёт
 * только ПОСЛЕ проверок: иначе посторонний с заведомо негодным тегом заставлял бы нас
 * читать все релизы и снимки версий, чтобы получить отказ.
 */

/**
 * Отказ по ВВОДУ — то, что форма показывает на месте, не стирая заметки.
 * Коды отказа — значения, а не адрес `?e=`: переход стирал форму (#832).
 */
export type ReleaseRefusal = 'badtag' | 'vreserved' | 'badversion' | 'tagtaken' | 'readonly' | 'tagfail'

export interface ReleaseInput {
  /** Версия списка; не задана — текущая. */
  version?: number
  tag: string
  title?: string
  notes?: string
  prerelease?: boolean
  /** Дописать под свои заметки дифф шагов (этим языком — и заголовки, и пункты). */
  generateNotes?: Lang
}

export type ReleaseOutcome =
  | {
      ok: true
      owner: string
      slug: string
      version: number
      tag: string
      /** Что записано на самом деле — с собранной частью и после обрезки. */
      notes: string
      /** Заметки длиннее предела и обрезаны: форма режет молча, агенту надо знать. */
      truncated: boolean
    }
  // `not_found` и `forbidden` — не ошибка ввода, а чужой адрес: форма о них молчит,
  // агенту нужно сказать словами.
  | { ok: false; reason: ReleaseRefusal | 'not_found' | 'forbidden' }

async function handleOf(userId: string): Promise<string> {
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1)
  return u?.handle ?? ''
}

/** Владелец или коллаборатор выпускает релиз из версии списка. */
export async function publishRelease(userId: string, templateId: string, input: ReleaseInput): Promise<ReleaseOutcome> {
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return { ok: false, reason: 'not_found' }
  const isOwner = tpl.ownerId === userId
  const isCollab = !isOwner && (await isCollaborator(tpl.id, userId))
  // Невидимый список (снят модерацией, чужой приватный) — «нет такого», как везде: иначе
  // коллаборатор снятого списка выпускал бы релиз формой, а агенту тот же список отвечал
  // «не найден».
  if (!canViewList(tpl, { isOwner, isCollaborator: isCollab })) return { ok: false, reason: 'not_found' }
  if (!isOwner && !isCollab) return { ok: false, reason: 'forbidden' }
  // Архив и заморозка — до похода в ядро: ядро отказало бы тоже, но общим «не удалось»,
  // и агент повторял бы то, что повтором не лечится. Как у GitHub: архивный репозиторий
  // релизов не выпускает.
  if (!canEditList(tpl)) return { ok: false, reason: 'readonly' }

  const version = input.version ?? tpl.currentVersion
  // Без дефолта `v<версия>`: такие имена зарезервированы за автотегами версий
  // (#590), пустой тег честно упадёт в badtag, а не в молчаливый отказ ядра.
  const tag = input.tag.trim()
  if (isReservedTag(tag)) return { ok: false, reason: 'vreserved' }
  if (!isValidTag(tag)) return { ok: false, reason: 'badtag' }
  // Не число («abc» из формы, дробь от агента) — сразу отказ, а не запрос с NaN.
  if (!Number.isInteger(version)) return { ok: false, reason: 'badversion' }
  const [v] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, tpl.id), eq(templateVersions.version, version)))
    .limit(1)
  if (!v) return { ok: false, reason: 'badversion' }

  const title = (input.title ?? '').trim().slice(0, RELEASE_TITLE_MAX)
  let notes = (input.notes ?? '').trim()
  if (input.generateNotes) {
    // Как у GitHub: свой текст ИДЁТ ПЕРВЫМ, собранное из диффа — под ним. Версия та же,
    // что уйдёт в тег: прочитанная второй раз, она могла бы уже сдвинуться.
    notes = [notes, await buildReleaseChangelog(tpl.id, version, input.generateNotes)].filter(Boolean).join('\n\n')
  }
  const truncated = notes.length > RELEASE_NOTES_MAX
  notes = notes.slice(0, RELEASE_NOTES_MAX)
  const owner = await handleOf(tpl.ownerId)
  const repo = { owner, slug: tpl.slug }
  // eslint-disable-next-line boundaries/dependencies -- тег релиза ставит ядро git; иначе релиз без тега (#590)
  const { gitCore } = await import('@/features/git/core')

  const refusal = await db.transaction(async (tx): Promise<ReleaseRefusal | null> => {
    // Один выпуск тега на список за раз. Без замка два одновременных вызова с одним
    // тегом оба проходили проверку ниже, ядро ставило тег дважды (с перезаписью), и
    // git указывал на версию одного, а строка релиза — на версию другого.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`release:${tpl.id}:${tag}`}))`)
    const [dup] = await tx
      .select({ id: releases.id })
      .from(releases)
      .where(and(eq(releases.templateId, tpl.id), eq(releases.tag, tag)))
      .limit(1)
    if (dup) return 'tagtaken'

    // Занятость тега — и в GIT, а не только в таблице: ядро ставит тег с перезаписью,
    // а тег мог прийти пушем или остаться от удалённого релиза. Тег на ТУ ЖЕ версию —
    // это повтор после сбоя записи (тег встал, строка нет), его пропускаем; на другую —
    // отказ, иначе тег молча переехал бы и в зеркале тоже.
    const tags = await gitCore.listTags(repo)
    const versionSha = tags.find((t) => t.name === `v${version}`)?.targetSha
    // Тега версии не видно — ядро не ответило (listTags глушит сбой в пустоту) или версия
    // ещё не доехала в git. Ставить вслепую нельзя: проверку выше не сделать.
    if (!versionSha) return 'tagfail'
    const existing = tags.find((t) => t.name === tag)
    if (existing && existing.targetSha !== versionSha) return 'tagtaken'

    // Git-тег — ДО вставки в базу: раньше сбой ядра глотался, и релиз существовал без
    // тега в git (#590). Теперь либо есть и тег, и релиз, либо ни того ни другого.
    try {
      await gitCore.createTag(repo, tag, version)
    } catch (err) {
      console.error(`[releases] git tag "${tag}" (v${version}) failed for ${owner}/${tpl.slug}:`, err)
      // Имя, которое ядро не приняло, — ошибка ввода, повтор её не вылечит.
      return err instanceof BranchOpError && err.code === 'bad-name' ? 'badtag' : 'tagfail'
    }
    await tx.insert(releases).values({ templateId: tpl.id, version, tag, title, notes, prerelease: input.prerelease === true, authorId: userId })
    return null
  })
  if (refusal) return { ok: false, reason: refusal }
  return { ok: true, owner, slug: tpl.slug, version, tag, notes, truncated }
}
