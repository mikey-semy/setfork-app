'use server'

import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, steps, suggestions, templates, users, type ProposedItem } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { recordAudit } from '@/shared/audit'
import { getLang } from '@/shared/i18n/server'
import { isLang, langEnName, tr, type LocaleText } from '@/shared/i18n'
import { imageUrl, uploadAttachmentFile, uploadImageFile, uploadVideoFile } from '@/shared/media'
import { generateChangeNote, generateListRefine, generateListTranslation } from '@/shared/ai/generate'
import { checkRateLimit } from '@/shared/ai/rate-limit'
import { rateLimit } from '@/shared/rate-limit'
import { fetchPublicUrl } from '@/shared/lib/safe-fetch'
import { aiQuota, listQuota } from '@/shared/quota'
import { textLang } from '@/shared/i18n/detect-text-lang'
import { notify, notifyMany, notifyMentions } from '@/features/notifications/notify'
import { enqueueReindex } from './jobs'
// eslint-disable-next-line boundaries/dependencies -- пере-привязка якорей комментариев (кросс-фич, как watch/collab)
import { syncBlockThreadAnchors } from '@/features/comments/sync'
import { ensureWatch } from '@/features/watch/actions'
import { getWatcherIds } from '@/features/watch/queries'
import { isCollaborator } from '@/features/collab/queries'
import { curationStore } from '@/features/curation/store'
import { collabStore, suggestionCommenterIds } from '@/features/collab-store/store'
import { gateListPublication, recheckList } from '@/features/moderation/moderate-list'
import { parseEditorItems, toProposedItems, type EditorItem } from './editor'
import { getVersionSteps } from './queries'
import { hasBlockingReview } from './review-actions'
import { listStore } from './list-store'
import { parseTags, slugify } from './slug'
import { registerTags } from '@/features/tags/service'
import { canEditList, canViewList } from '@/core'

/** ProposedItem[] → доменный вход шагов для ListStore.addVersion. */
function toStepInput(items: ProposedItem[]) {
  return items.map((it, i) => ({
    n: i + 1,
    type: it.type ?? 'step',
    content: it.content ?? {},
    blockId: it.blockId ?? null,
    title: it.title,
    desc: it.desc,
    command: it.command,
    level: it.level,
    why: it.why,
    section: it.section,
    subtasks: it.subtasks,
    refs: it.refs,
    imageRef: it.imageKey ?? null,
  }))
}

// ── Видимость списка (public/private) и удаление ─────────────────────
export async function setListVisibility(templateId: string, visibility: 'public' | 'private'): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  if (visibility === 'private') {
    // приватному гейт не нужен — сбрасываем ТОЛЬКО pending; flagged/hidden не
    // «отмываются» toggle'ом видимости — админский takedown снимает только админ.
    const reset =
      tpl.moderation === 'pending'
        ? { moderation: 'active' as const, moderationReason: null, moderationSeverity: 0 }
        : {}
    await db.update(templates).set({ visibility, ...reset }).where(eq(templates.id, templateId))
  } else {
    await db.update(templates).set({ visibility }).where(eq(templates.id, templateId))
    await gateListPublication(templateId) // публикация → гейт: pending до авто-проверки
  }
  revalidatePath(`/${session.handle}/${tpl.slug}`)
  revalidatePath('/explore')
}

/** «Customize your pins»: закрепить ровно выбранный набор своих списков (кап 6). */
export async function updatePins(templateIds: string[]): Promise<void> {
  const session = await requireSession()
  const ids = templateIds.slice(0, 6)
  // Сначала снимаем все свои пины, затем ставим выбранные — итог точно равен выбору.
  await db.update(templates).set({ pinned: false }).where(eq(templates.ownerId, session.userId))
  if (ids.length) {
    await db
      .update(templates)
      .set({ pinned: true })
      .where(and(eq(templates.ownerId, session.userId), inArray(templates.id, ids)))
  }
  revalidatePath(`/${session.handle}`)
}

export async function setListPinned(templateId: string, pinned: boolean): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  await db.update(templates).set({ pinned }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}`)
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

export async function deleteListAction(templateId: string): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  // Снятый модерацией список владелец удалить не может: hard-delete стёр бы его
  // contentFingerprint — единственную защиту от повторной заливки того же контента
  // (отмывка «удалил → залил заново»). Снять/удалить takedown вправе только админ;
  // легитимный путь для владельца — апелляция.
  if ((tpl.moderation === 'flagged' || tpl.moderation === 'hidden') && !isAdminHandle(session.handle)) {
    redirect(`/${session.handle}/${tpl.slug}/settings?e=locked_moderation`)
  }
  await db.delete(templates).where(eq(templates.id, templateId)) // каскад: версии/шаги/звёзды/предложения
  await recordAudit('list.delete', { actorId: session.userId, targetType: 'list', targetId: templateId, meta: { slug: tpl.slug } })
  revalidatePath('/', 'layout')
  redirect(`/${session.handle}`)
}

// ── Обратимые состояния: архив (read-only) и заморозка правок ─────────
// Владелец переключает из Danger Zone. Ставят/снимают timestamp; сами эти
// экшены доступны и в архиве (иначе разархивировать было бы нечем).
export async function setListArchived(templateId: string, on: boolean): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  await db.update(templates).set({ archivedAt: on ? new Date() : null }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}`, 'layout')
}

export async function setListFrozen(templateId: string, on: boolean): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  await db.update(templates).set({ frozenAt: on ? new Date() : null }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}`, 'layout')
}

// ── Загрузка скриншота шага (в редакторе) ────────────────────────────
export async function uploadStepImage(formData: FormData): Promise<{ key: string; url: string } | { error: string }> {
  const session = await requireSession()
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Файл не выбран.' }
  try {
    const key = await uploadImageFile(`steps/${session.userId}`, file)
    return { key, url: (await imageUrl(key, 'rs:fit:960:960')) ?? '' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Не удалось загрузить.' }
  }
}

/** Загрузка своего видео-файла (video-блок) → путь /uploads/videos/... для <video>. */
export async function uploadStepVideo(formData: FormData): Promise<{ url: string } | { error: string }> {
  const session = await requireSession()
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Файл не выбран.' }
  try {
    const url = await uploadVideoFile(`videos/${session.userId}`, file)
    return { url }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Не удалось загрузить.' }
  }
}

/** Загрузка вложения (file-блок): PDF/архив/… → путь /uploads/files/... + имя. */
export async function uploadStepFile(formData: FormData): Promise<{ url: string; name: string } | { error: string }> {
  await requireSession()
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Файл не выбран.' }
  try {
    return await uploadAttachmentFile(file)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Не удалось загрузить.' }
  }
}

async function notifyWatchersNewVersion(templateId: string, actorId: string): Promise<void> {
  const watchers = await getWatcherIds(templateId, 'versions')
  await notifyMany(watchers, { actorId, type: 'new_version', templateId })
}

async function ownerHandle(userId: string): Promise<string> {
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  return u.handle
}

// ── Создание списка ───────────────────────────────────────────────────
export async function createTemplate(formData: FormData): Promise<void> {
  const session = await requireSession()
  const lang = await getLang()
  const title = String(formData.get('title') ?? '').trim()
  const desc = String(formData.get('desc') ?? '').trim()
  const tags = parseTags(formData.get('tags'))
  const visibility = formData.get('visibility') === 'private' ? 'private' : 'public'
  const ordered = formData.get('ordered') !== 'unordered'
  const gated = formData.get('gated') === 'on'
  const proposed = toProposedItems(parseEditorItems(formData.get('items')), lang)
  if (!title) return
  // Квота на число списков (мягкая защита от абьюза; админ без лимита).
  if (!(await listQuota(session.userId, session.handle)).ok) redirect('/new?e=list_quota')

  let slug = slugify(title)
  const owned = await db
    .select({ slug: templates.slug })
    .from(templates)
    .where(and(eq(templates.ownerId, session.userId), eq(templates.slug, slug)))
  if (owned.length) slug = `${slug}-${Date.now().toString(36).slice(-4)}`

  const list = await listStore.create({
    ownerId: session.userId,
    slug,
    title: { [lang]: title },
    desc: desc ? { [lang]: desc } : {},
    tags,
    ordered,
    visibility,
    status: 'published',
    origin: 'authored',
    note: 'initial',
    steps: toStepInput(proposed),
  })
  if (gated) await db.update(templates).set({ gated: true }).where(eq(templates.id, list.id)) // course quiz-gate
  await registerTags(tags) // новые теги → в реестр
  await ensureWatch(list.id) // владелец следит за своим списком
  if (visibility === 'public') await gateListPublication(list.id) // приватные не модерируем
  await enqueueReindex(list.id) // авто-индексация в поиск (через очередь)

  redirect(`/${await ownerHandle(session.userId)}/${slug}`)
}

// ── Владелец: правка метаданных списка (название/описание/теги/порядок) ──
// slug НЕ трогаем — он технический и авто-генерённый, пользователя не касается.
// title/desc меняем в ТЕКУЩЕМ языке интерфейса, значения на других языках сохраняем.
export async function updateListMeta(templateId: string, formData: FormData): Promise<void> {
  const session = await requireSession()
  const lang = await getLang()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return // название обязательно
  const desc = String(formData.get('desc') ?? '').trim()
  const tags = parseTags(formData.get('tags'))
  const ordered = formData.get('ordered') !== 'unordered'
  await db
    .update(templates)
    .set({
      title: { ...(tpl.title as LocaleText), [lang]: title },
      desc: { ...(tpl.desc as LocaleText), [lang]: desc },
      tags,
      ordered,
      updatedAt: new Date(),
    })
    .where(eq(templates.id, templateId))
  await registerTags(tags)
  revalidatePath(`/${session.handle}/${tpl.slug}`)
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

// ── Владелец: сохранить как новую версию ─────────────────────────────
export async function saveNewVersion(templateId: string, formData: FormData): Promise<void> {
  const session = await requireSession()
  const [lang, tpl] = await Promise.all([getLang(), db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })])
  if (!tpl) return
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return

  const note = String(formData.get('note') ?? '').trim()
  const tags = parseTags(formData.get('tags'))
  const ordered = formData.get('ordered') !== 'unordered'
  const gated = formData.get('gated') === 'on'
  const proposed = toProposedItems(parseEditorItems(formData.get('items')), lang)

  // Создание версии+шагов идёт через доменный порт ListStore (write-seam под Rust).
  await listStore.addVersion(tpl.id, { note: note || 'edit', steps: toStepInput(proposed), authorId: session.userId })
  // tags/ordered/gated — атрибуты списка, не версии; обновляем отдельно.
  await db.update(templates).set({ tags, ordered, gated, updatedAt: new Date() }).where(eq(templates.id, tpl.id))
  await registerTags(tags)
  // Пере-проверку публичного списка делает фасад listStore.addVersion (барьер) — здесь не дублируем.
  await notifyWatchersNewVersion(tpl.id, session.userId)
  // Якоря комментариев переезжают на новую версию: часть сдвинется, часть
  // осиротеет — тред честно покажет своё состояние вместо молчаливой пропажи.
  await syncBlockThreadAnchors(tpl.id)
  await enqueueReindex(tpl.id)

  redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}`)
}

// ── Возврат к прошлой версии ──────────────────────────────────────────
/**
 * «Вернуть эту версию» — семантика revert из GitHub: содержимое версии N
 * копируется в НОВУЮ версию N+1, история не переписывается и не теряется
 * (откат самого отката тоже возможен). Идёт через ListStore.addVersion —
 * тот же путь, что у обычного сохранения, включая запись в git.
 */
export async function revertToVersion(templateId: string, version: number): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return
  // Возвращать можно только к существующей ПРОШЛОЙ версии (текущая — не откат).
  if (!Number.isInteger(version) || version < 1 || version >= tpl.currentVersion) return

  const snap = await getVersionSteps(tpl.id, version)
  if (!snap) return

  await listStore.addVersion(tpl.id, {
    note: `revert to v${version}`,
    steps: toStepInput(snap.steps as unknown as ProposedItem[]),
    authorId: session.userId,
  })
  await notifyWatchersNewVersion(tpl.id, session.userId)
  // Якоря комментариев переезжают на новую версию: часть сдвинется, часть
  // осиротеет — тред честно покажет своё состояние вместо молчаливой пропажи.
  await syncBlockThreadAnchors(tpl.id)
  await enqueueReindex(tpl.id)

  const handle = await ownerHandle(tpl.ownerId)
  revalidatePath(`/${handle}/${tpl.slug}`)
  revalidatePath(`/${handle}/${tpl.slug}/versions`)
  redirect(`/${handle}/${tpl.slug}`)
}

// ── Предложить правку (PR) ────────────────────────────────────────────
export async function submitSuggestion(templateId: string, formData: FormData): Promise<void> {
  const session = await requireSession()
  const [lang, tpl] = await Promise.all([getLang(), db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })])
  if (!tpl) return
  // Нельзя предлагать правки к приватному/скрытому списку, которого не видишь
  // (иначе — запись в чужую очередь + пинг владельцу + оракул существования).
  if (!canViewList(tpl, { isOwner: tpl.ownerId === session.userId })) return
  // Архив/заморозка: предложения запрещены в обоих состояниях (список только-чтение).
  if (!canEditList(tpl)) redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}?e=${tpl.archivedAt ? 'archived' : 'frozen'}`)
  // Анти-спам: правки — запись в чужую очередь + пинг владельца/упомянутых. Кап на автора.
  if (!(await rateLimit(`suggest:${session.userId}`, 10, 10 * 60_000)).ok) {
    redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}/suggestions?e=ratelimited`)
  }

  const note = String(formData.get('note') ?? '').trim()
  const proposed = toProposedItems(parseEditorItems(formData.get('items')), lang)

  const created = await collabStore.createSuggestion(tpl.id, session.userId, note, toStepInput(proposed))
  await ensureWatch(tpl.id) // автор правки следит за списком
  await notify({ recipientId: tpl.ownerId, actorId: session.userId, type: 'suggestion_new', templateId: tpl.id, suggestionId: created.id })
  await notifyMentions({ text: note, actorId: session.userId, templateId: tpl.id })

  redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}/suggestions`)
}

// ── A3: PR из ветки («ветка → main») ─────────────────────────────────
export async function openBranchPr(templateId: string, branch: string): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return
  // Ветки пушит только владелец/коллаборатор → и PR из ветки открывают они же
  // (push-концепт). Заодно закрывает открытие PR на чужом приватном списке.
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return
  const [{ gitCore }, owner] = await Promise.all([import('@/features/git/core'), ownerHandle(tpl.ownerId)])
  // Ветка должна существовать и содержать list.json (иначе PR не из чего собрать).
  const snap = await gitCore.branchSnapshot({ owner, slug: tpl.slug }, branch).catch(() => null)
  if (!snap) redirect(`/${owner}/${tpl.slug}`)
  // Один открытый PR на ветку: повторное «Open PR» ведёт на существующий.
  const dup = await db.query.suggestions.findFirst({
    where: (s) => and(eq(s.templateId, tpl.id), eq(s.branchRef, branch), eq(s.status, 'open')),
  })
  if (dup) redirect(`/${owner}/${tpl.slug}/suggestions/${dup.id}`)

  const [created] = await db
    .insert(suggestions)
    .values({
      templateId: tpl.id,
      authorId: session.userId,
      note: `Merge branch '${branch}'`,
      baseVersion: tpl.currentVersion,
      items: [], // источник правды — tip ветки, материализуется при просмотре
      branchRef: branch,
    })
    .returning({ id: suggestions.id })
  await ensureWatch(tpl.id)
  if (tpl.ownerId !== session.userId) {
    await notify({ recipientId: tpl.ownerId, actorId: session.userId, type: 'suggestion_new', templateId: tpl.id, suggestionId: created.id })
  }
  redirect(`/${owner}/${tpl.slug}/suggestions/${created.id}`)
}

/** Владелец/коллаборатор: влить branch-PR (ff или merge-commit + проекция). */
export async function mergeBranchPr(suggestionId: string): Promise<void> {
  const session = await requireSession()
  const sug = await db.query.suggestions.findFirst({
    where: (s) => eq(s.id, suggestionId),
    with: { template: true },
  })
  if (!sug || sug.status !== 'open' || !sug.branchRef) return
  const tpl = sug.template
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return
  // Тот же гейт, что у принятия items-правки: иначе «Влить в main» обходило бы
  // запрошенные правки, и вердикт зависел бы от того, каким путём пришёл PR.
  if (await hasBlockingReview(sug.id)) return

  const owner = await ownerHandle(tpl.ownerId)
  const path = `/${owner}/${tpl.slug}/suggestions/${sug.id}`
  const [{ gitCore }, { BranchOpError }] = await Promise.all([import('@/features/git/core'), import('@/core')])
  try {
    await gitCore.mergeBranch({ owner, slug: tpl.slug }, sug.branchRef)
  } catch (e) {
    const code = e instanceof BranchOpError ? e.code : 'internal'
    redirect(`${path}?e=${code}`)
  }
  await db.update(suggestions).set({ status: 'accepted', resolvedAt: new Date() }).where(eq(suggestions.id, sug.id))
  if (sug.authorId !== session.userId) {
    await notify({ recipientId: sug.authorId, actorId: session.userId, type: 'suggestion_accepted', templateId: tpl.id, suggestionId: sug.id })
  }
  // git-merge создаёт версию МИМО listStore.addVersion → фасадный барьер её не ловит, recheck явно.
  if (tpl.visibility === 'public') await recheckList(tpl.id)
  await notifyWatchersNewVersion(tpl.id, session.userId)
  // Якоря комментариев переезжают на новую версию: часть сдвинется, часть
  // осиротеет — тред честно покажет своё состояние вместо молчаливой пропажи.
  await syncBlockThreadAnchors(tpl.id)
  await enqueueReindex(tpl.id)
  revalidatePath('/', 'layout')
  redirect(`/${owner}/${tpl.slug}`)
}

/** A4: merge branch-PR c ручным разрешением конфликтов по шагам.
 *  Сервер пересчитывает three-way детерминированно и применяет выбор —
 *  клиентскому результату не доверяем. */
export async function resolveBranchPr(suggestionId: string, formData: FormData): Promise<void> {
  const session = await requireSession()
  const sug = await db.query.suggestions.findFirst({
    where: (s) => eq(s.id, suggestionId),
    with: { template: true },
  })
  if (!sug || sug.status !== 'open' || !sug.branchRef) return
  const tpl = sug.template
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return

  const owner = await ownerHandle(tpl.ownerId)
  const path = `/${owner}/${tpl.slug}/suggestions/${sug.id}`

  const isChoice = (v: unknown): v is 'ours' | 'theirs' => v === 'ours' || v === 'theirs'
  let stepChoices: Record<string, 'ours' | 'theirs'> = {}
  let metaChoices: Record<string, 'ours' | 'theirs'> = {}
  try {
    const sc = JSON.parse(String(formData.get('stepChoices') ?? '{}')) as Record<string, unknown>
    const mc = JSON.parse(String(formData.get('metaChoices') ?? '{}')) as Record<string, unknown>
    stepChoices = Object.fromEntries(Object.entries(sc).filter(([, v]) => isChoice(v))) as typeof stepChoices
    metaChoices = Object.fromEntries(Object.entries(mc).filter(([, v]) => isChoice(v))) as typeof metaChoices
  } catch {
    redirect(`${path}?e=unresolved`)
  }

  const [{ gitCore }, { threeWayMerge, applyChoices }, { BranchOpError }] = await Promise.all([
    import('@/features/git/core'),
    import('@/features/git/three-way'),
    import('@/core'),
  ])

  const state = await gitCore.mergeState({ owner, slug: tpl.slug }, sug.branchRef).catch(() => null)
  if (!state) redirect(`${path}?e=not-found`)
  const res = threeWayMerge(state.base, state.ours, state.theirs)
  const final = applyChoices(res, stepChoices, metaChoices)
  if (!final) redirect(`${path}?e=unresolved`) // выбраны не все конфликты (или state изменился)

  // Каноничный формат list.json — как versionFiles (serialize.ts).
  const listJson =
    JSON.stringify(
      {
        title: final.title,
        desc: final.desc,
        tags: final.tags,
        ordered: final.ordered,
        version: tpl.currentVersion + 1,
        steps: final.steps.map((s, i) => ({ n: i + 1, ...s })),
      },
      null,
      2,
    ) + '\n'

  try {
    await gitCore.mergeResolved({ owner, slug: tpl.slug }, sug.branchRef, listJson)
  } catch (e) {
    const code = e instanceof BranchOpError ? e.code : 'internal'
    redirect(`${path}?e=${code}`)
  }
  await db.update(suggestions).set({ status: 'accepted', resolvedAt: new Date() }).where(eq(suggestions.id, sug.id))
  if (sug.authorId !== session.userId) {
    await notify({ recipientId: sug.authorId, actorId: session.userId, type: 'suggestion_accepted', templateId: tpl.id, suggestionId: sug.id })
  }
  // git-merge создаёт версию МИМО listStore.addVersion → фасадный барьер её не ловит, recheck явно.
  if (tpl.visibility === 'public') await recheckList(tpl.id)
  await notifyWatchersNewVersion(tpl.id, session.userId)
  // Якоря комментариев переезжают на новую версию: часть сдвинется, часть
  // осиротеет — тред честно покажет своё состояние вместо молчаливой пропажи.
  await syncBlockThreadAnchors(tpl.id)
  await enqueueReindex(tpl.id)
  revalidatePath('/', 'layout')
  redirect(`/${owner}/${tpl.slug}`)
}

// ── Автор списка: принять предложение → новая версия ─────────────────
export async function acceptSuggestion(suggestionId: string): Promise<void> {
  const session = await requireSession()
  const sug = await db.query.suggestions.findFirst({
    where: (s) => eq(s.id, suggestionId),
    with: { template: true },
  })
  if (!sug || sug.status !== 'open' || sug.template.ownerId !== session.userId) return
  // Запрошенные правки блокируют принятие — иначе вердикт «просит доработать»
  // был бы декоративным. Разблокировать может сам рецензент, сменив свой голос.
  if (await hasBlockingReview(sug.id)) return

  const tpl = sug.template
  // Новая версия из принятого предложения — через доменный порт.
  await listStore.addVersion(tpl.id, { note: sug.note || 'suggested edit', steps: toStepInput(sug.items), authorId: session.userId })
  // Пере-проверку делает фасад listStore.addVersion (барьер) — здесь не дублируем.
  await db
    .update(suggestions)
    .set({ status: 'accepted', resolvedAt: new Date() })
    .where(eq(suggestions.id, sug.id))
  await notify({ recipientId: sug.authorId, actorId: session.userId, type: 'suggestion_accepted', templateId: tpl.id, suggestionId: sug.id })
  await notifyWatchersNewVersion(tpl.id, session.userId)
  // Якоря комментариев переезжают на новую версию: часть сдвинется, часть
  // осиротеет — тред честно покажет своё состояние вместо молчаливой пропажи.
  await syncBlockThreadAnchors(tpl.id)
  await enqueueReindex(tpl.id)

  revalidatePath('/', 'layout')
  redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}`)
}

// ── Обсуждение предложения (review-комментарии) ──────────────────────
export async function addSuggestionComment(formData: FormData): Promise<void> {
  const session = await requireSession()
  const suggestionId = String(formData.get('suggestionId') ?? '')
  const body = String(formData.get('body') ?? '').trim().slice(0, 20000)
  const sug = await db.query.suggestions.findFirst({
    where: (s) => eq(s.id, suggestionId),
    with: { template: true },
  })
  if (!sug) return
  // Комментарий к правке — запись в тред списка: только если список видим комментатору
  // (список мог стать приватным/скрытым после публикации PR; reactions уже так гейтят).
  if (!canViewList(sug.template, { isOwner: sug.template.ownerId === session.userId })) return
  const handle = await ownerHandle(sug.template.ownerId)
  const path = `/${handle}/${sug.template.slug}/suggestions/${sug.id}`
  // Анти-спам: комментарий рассылает уведомления автору+владельцу+комментаторам+watcher'ам.
  if (!(await rateLimit(`sugcomment:${session.userId}`, 20, 5 * 60_000)).ok) redirect(`${path}?e=ratelimited`)
  if (!body) redirect(path)

  await collabStore.addSuggestionComment(sug.id, session.userId, body)
  await ensureWatch(sug.templateId)

  const [commenters, watchers] = await Promise.all([suggestionCommenterIds(sug.id), getWatcherIds(sug.templateId, 'suggestions')])
  const recipients = [sug.authorId, sug.template.ownerId, ...commenters, ...watchers]
  await notifyMany(recipients, { actorId: session.userId, type: 'suggestion_comment', templateId: sug.templateId, suggestionId: sug.id })
  await notifyMentions({ text: body, actorId: session.userId, templateId: sug.templateId })

  revalidatePath(path)
  redirect(path)
}

// ── Автор списка: отклонить предложение ──────────────────────────────
export async function rejectSuggestion(suggestionId: string): Promise<void> {
  const session = await requireSession()
  const sug = await db.query.suggestions.findFirst({
    where: (s) => eq(s.id, suggestionId),
    with: { template: true },
  })
  if (!sug || sug.status !== 'open' || sug.template.ownerId !== session.userId) return

  await db
    .update(suggestions)
    .set({ status: 'rejected', resolvedAt: new Date() })
    .where(eq(suggestions.id, sug.id))
  await notify({ recipientId: sug.authorId, actorId: session.userId, type: 'suggestion_rejected', templateId: sug.templateId, suggestionId: sug.id })
  revalidatePath('/', 'layout')
}

// ── AI-refine: правка пунктов редактора по инструкции ────────────────
export async function refineList(input: {
  items: EditorItem[]
  title: string
  desc: string
  tags: string[]
  instruction: string
}): Promise<{ items: EditorItem[] } | { error: string }> {
  const session = await requireSession()
  const lang = await getLang()
  const instruction = String(input.instruction ?? '').trim()
  if (!instruction) return { error: 'empty' }

  const { allowed } = await checkRateLimit(`refine:${session.userId}`)
  if (!allowed) return { error: 'ratelimited' }
  if (!(await aiQuota(session.userId, session.handle)).ok) return { error: 'ai_quota' }

  const current = {
    title: input.title || '',
    desc: input.desc || '',
    tags: input.tags || [],
    items: (input.items || [])
      .filter((it) => it.title?.trim())
      .map((it) => ({
        title: it.title,
        desc: it.desc,
        command: it.command,
        level: it.level ?? 'required',
        why: it.why ?? '',
        subtasks: (it.subtasks || []).filter((s) => s.trim()),
        refs: (it.refs || []).filter((r) => r.label?.trim() && r.url?.trim()).map((r) => ({ label: r.label, url: r.url })),
      })),
  }
  // Язык рефайна = язык СОДЕРЖИМОГО списка, не интерфейса: русский список при
  // en-интерфейсе иначе «улучшался» переводом. Пустой черновик → язык интерфейса.
  const contentLang = current.title || current.items.length
    ? textLang([current.title, current.desc, ...current.items.flatMap((it) => [it.title, it.desc])])
    : lang
  const refined = await generateListRefine(current, instruction, contentLang, { userId: session.userId, feature: 'refine' })
  if (!refined) return { error: 'aifail' }

  // Refine переписывает текстовое содержимое шагов; скриншоты не переносятся, ссылки — да.
  const items: EditorItem[] = refined.items.map((it) => ({
    type: 'step' as const,
    bid: '',
    text: '',
    caption: '',
    videoUrl: '',
    fileUrl: '',
    fileName: '',
    poll: { question: '', options: [], multi: false, deadline: '' },
    quiz: { kind: 'choice' as const, question: '', options: [], multi: false, accept: [], caseSensitive: false, answer: '', tolerance: '', template: '', blanks: [], pairs: [], items: [], explain: '' },
    products: [],
    title: it.title,
    desc: it.desc,
    command: it.command,
    imageKey: '',
    imagePreview: '',
    level: it.level,
    why: it.why,
    section: '',
    subtasks: it.subtasks,
    refs: (it.refs ?? []).map((r) => ({ label: r.label, url: r.url })),
  }))
  return { items }
}

// ── AI-перевод списка: добавить язык, не трогая оригинал (ADR-0009) ───
export async function translateList(templateId: string, targetLang: string): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession()
  if (!isLang(targetLang)) return { error: 'badlang' }
  const tpl = await db.query.templates.findFirst({
    where: (t) => eq(t.id, templateId),
    with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
  })
  if (!tpl) return { error: 'notfound' }
  // Перевод = правка контента: владелец или коллаборатор (как saveNewVersion).
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return { error: 'forbidden' }

  const { allowed } = await checkRateLimit(`translate:${session.userId}`)
  if (!allowed) return { error: 'ratelimited' }
  if (!(await aiQuota(session.userId, session.handle)).ok) return { error: 'ai_quota' }

  const cur = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[0]
  if (!cur) return { error: 'notfound' }
  const rows = await db.query.steps.findMany({ where: (s) => eq(s.versionId, cur.id), orderBy: (s, { asc }) => asc(s.n) })

  // Исходный текст поля: значение на любом уже имеющемся языке (en → первый).
  const pick = (lt: LocaleText | null | undefined): string => (lt ? (lt.en ?? Object.values(lt).find(Boolean) ?? '') : '')
  const current = {
    title: pick(tpl.title),
    desc: pick(tpl.desc),
    items: rows.map((s) => ({
      title: pick(s.title),
      desc: pick(s.desc),
      command: s.command,
      level: s.level,
      why: pick(s.why),
      subtasks: (s.subtasks as LocaleText[]).map(pick),
      refs: (s.refs as { label: LocaleText; url?: string }[]).map((r) => ({ label: pick(r.label), url: r.url ?? '' })),
    })),
  }

  const translated = await generateListTranslation(current, targetLang, { userId: session.userId, feature: 'translate' })
  if (!translated) return { error: 'aifail' }
  // Модель обязана сохранить порядок и число шагов — иначе мёрж по индексу уедет.
  if (translated.items.length !== rows.length) return { error: 'mismatch' }

  // Добавить ключ targetLang к LocaleText, СОХРАНИВ существующие языки.
  const add = (lt: LocaleText | null | undefined, val: string): LocaleText => {
    const base = (lt ?? {}) as LocaleText
    return val.trim() ? { ...base, [targetLang]: val.trim() } : base
  }
  const proposed: ProposedItem[] = rows.map((s, i) => {
    const t = translated.items[i]
    const subs = s.subtasks as LocaleText[]
    const refs = s.refs as { label: LocaleText; url?: string }[]
    return {
      type: s.type,
      content: s.content, // poll/quiz/product-контент в v1 не переводим (оставляем как есть)
      title: add(s.title, t.title),
      desc: add(s.desc, t.desc),
      command: s.command,
      hasImage: s.hasImage,
      imageKey: s.imageKey ?? undefined,
      level: s.level,
      why: add(s.why, t.why),
      section: s.section as LocaleText, // секция — заголовок урока; переведём в v2
      subtasks: subs.map((st, k) => add(st, t.subtasks[k] ?? '')),
      refs: refs.map((r, k) => ({ label: add(r.label, t.refs[k]?.label ?? ''), ...(r.url ? { url: r.url } : {}) })),
    }
  })

  const note = `translate → ${langEnName(targetLang)}`
  await listStore.addVersion(tpl.id, { note, steps: toStepInput(proposed), authorId: session.userId })
  // Также перевести title/desc самого списка (в templates, не в шагах).
  await db
    .update(templates)
    .set({ title: add(tpl.title, translated.title), desc: add(tpl.desc, translated.desc), updatedAt: new Date() })
    .where(eq(templates.id, tpl.id))
  await notifyWatchersNewVersion(tpl.id, session.userId)

  const owner = await db.select({ handle: users.handle }).from(users).where(eq(users.id, tpl.ownerId)).limit(1)
  if (owner[0]) revalidatePath(`/${owner[0].handle}/${tpl.slug}`)
  return { ok: true }
}

// ── AI: примечание к версии из диффа (What changed & why) ────────────
export async function generateChangeNoteAction(
  templateId: string,
  itemsJson: string,
): Promise<{ note: string } | { error: string }> {
  const session = await requireSession()
  const [lang, tpl] = await Promise.all([
    getLang(),
    db.query.templates.findFirst({
      where: (t) => eq(t.id, templateId),
      with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
    }),
  ])
  // Доступно всем, кто может видеть список: владельцу на /edit и предлагающему на
  // /suggest. Генерация читает публичный контент + их черновик; расход считается
  // per-user и ограничен rate-limit'ом + месячной AI-квотой (как generate/refine).
  if (!tpl || !canViewList(tpl, { isOwner: tpl.ownerId === session.userId })) return { error: 'forbidden' }

  const { allowed } = await checkRateLimit(`note:${session.userId}`)
  if (!allowed) return { error: 'ratelimited' }
  if (!(await aiQuota(session.userId, session.handle)).ok) return { error: 'ai_quota' }

  const cur = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[0]
  const baseSteps = cur
    ? await db.select().from(steps).where(eq(steps.versionId, cur.id)).orderBy(asc(steps.n))
    : []
  const base = baseSteps.map((s) => ({
    title: tr(s.title, lang),
    desc: tr(s.desc, lang),
    command: s.command,
    subtasks: s.subtasks.map((x) => tr(x, lang)),
  }))
  const next = parseEditorItems(itemsJson)
    .filter((it) => it.title.trim())
    .map((it) => ({ title: it.title, desc: it.desc, command: it.command, subtasks: it.subtasks.filter((s) => s.trim()) }))

  const note = await generateChangeNote(base, next, lang, { userId: session.userId, refType: 'template', refId: tpl.id })
  if (!note) return { error: 'aifail' }
  return { note }
}

// ── Автозаголовок ссылки: тянем <title>/og:title со страницы по URL ──────────
// Кнопка «сгенерировать» в ref-блоке редактора: пользователь вставил URL — по нему
// достаём человекочитаемое название страницы в подпись. Требуем сессию + rate-limit;
// SSRF-гейт (протоколы, приватные хосты, redirect-hop, DNS-rebind) — в fetchPublicUrl.

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)) } catch { return '' } })
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
  const tt = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return decodeEntities(og?.[1] ?? tt?.[1] ?? '').slice(0, 120)
}

export async function fetchLinkTitleAction(url: string): Promise<{ label: string } | { error: string }> {
  const session = await requireSession()
  const { allowed } = await checkRateLimit(`linktitle:${session.userId}`)
  if (!allowed) return { error: 'ratelimited' }

  let u: URL
  try { u = new URL(url.trim()) } catch { return { error: 'badurl' } }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'badurl' }

  try {
    const res = await fetchPublicUrl(u, {
      signal: AbortSignal.timeout(6000),
      headers: { 'user-agent': 'SetForkBot/1.0 (+https://setfork.com)', accept: 'text/html,application/xhtml+xml' },
    })
    if (!res) return { error: 'badurl' }
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return { error: 'fetchfail' }
    const html = (await res.text()).slice(0, 200_000)
    const label = extractTitle(html)
    return label ? { label } : { error: 'fetchfail' }
  } catch {
    return { error: 'fetchfail' }
  }
}

// ── Публикация черновика (draft → published) ─────────────────────────
export async function publishList(templateId: string): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId || tpl.status !== 'draft') return

  await db.update(templates).set({ status: 'published', updatedAt: new Date() }).where(eq(templates.id, tpl.id))
  // Публикуем публичный список → гейт: pending до авто-проверки (приватный не трогаем).
  if (tpl.visibility === 'public') await gateListPublication(tpl.id)

  revalidatePath('/', 'layout')
  redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}`)
}

// ── Star (сигнал качества + личная коллекция) ────────────────────────
export async function toggleStar(templateId: string): Promise<void> {
  const session = await requireSession()
  // Видимость проверяем ДО тоггла: нельзя звездить (и пинговать владельца)
  // приватный/скрытый список, которого не видишь.
  const [t] = await db
    .select({ ownerId: templates.ownerId, visibility: templates.visibility, status: templates.status, moderation: templates.moderation })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
  if (!t || !canViewList(t, { isOwner: t.ownerId === session.userId })) return
  const nowStarred = await curationStore.toggleStar(templateId, session.userId)
  if (nowStarred) await notify({ recipientId: t.ownerId, actorId: session.userId, type: 'star', templateId })
  revalidatePath('/', 'layout')
}

// ── Форк ──────────────────────────────────────────────────────────────
// ── «Use this template»: копия списка БЕЗ fork-связи ─────────────────
export async function setListTemplate(templateId: string, isTemplate: boolean): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  await db.update(templates).set({ isTemplate }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}`)
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

// Владелец включает/выключает опциональные разделы списка (Issues/Discussions).
// Suggestions — ядро fork-модели, не отключается. Выключенный раздел прячется из
// шапки, а его роуты отдают notFound (гейт на самих страницах).
export async function setListFeatures(templateId: string, feature: 'issues' | 'discussions', on: boolean): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  const patch = feature === 'issues' ? { issuesEnabled: on } : { discussionsEnabled: on }
  await db.update(templates).set(patch).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}`)
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

/** Создать свой список на основе шаблона: копия текущей версии, origin
 *  authored, без forked_from (в этом отличие от форка). */
export async function useTemplate(templateId: string): Promise<void> {
  const session = await requireSession()
  const src = await db.query.templates.findFirst({
    where: (t) => eq(t.id, templateId),
    with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
  })
  // Только помеченные шаблоном и видимые (публичные или свои).
  if (!src || !src.isTemplate) return
  if (src.visibility === 'private' && src.ownerId !== session.userId) return
  if (!(await listQuota(session.userId, session.handle)).ok) redirect(`/${session.handle}?e=list_quota`)

  const owned = await db
    .select({ slug: templates.slug })
    .from(templates)
    .where(and(eq(templates.ownerId, session.userId), eq(templates.slug, src.slug)))
  const slug = owned.length ? `${src.slug}-copy` : src.slug

  const srcCurrent = src.versions.find((v) => v.version === src.currentVersion) ?? src.versions[0]
  const srcSteps = srcCurrent
    ? await db.select().from(steps).where(eq(steps.versionId, srcCurrent.id)).orderBy(asc(steps.n))
    : []
  const created = await listStore.create({
    ownerId: session.userId,
    slug,
    title: src.title,
    desc: src.desc,
    tags: src.tags,
    ordered: src.ordered,
    visibility: 'public',
    status: 'published',
    origin: 'authored', // шаблон — стартовая точка, не fork-связь
    forkedFromId: null,
    note: `from template ${src.slug}`,
    steps: srcSteps.map((s, i) => ({
      n: i + 1,
      type: s.type ?? 'step', // блочная модель: копия не должна терять text/image блоки
      content: s.content ?? {},
      title: s.title,
      desc: s.desc,
      command: s.command,
      level: s.level,
      why: s.why,
      section: s.section,
      subtasks: s.subtasks,
      refs: s.refs,
      imageRef: s.imageKey ?? null,
    })),
  })
  await gateListPublication(created.id) // копия публикуется — гейт как у любой публикации
  revalidatePath('/', 'layout')
  redirect(`/${session.handle}/${slug}`)
}

export type ForkResult = { error?: string }

/** Статус имени будущего форка для диалога (как «EcoPlay is available ✓» на GitHub):
 *  нормализованный slug + свободно ли оно в пространстве текущего пользователя. */
export async function forkNameStatus(name: string): Promise<{ slug: string; available: boolean }> {
  const session = await requireSession()
  const slug = slugify(name)
  const [taken] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.ownerId, session.userId), eq(templates.slug, slug)))
    .limit(1)
  return { slug, available: !taken }
}

/** Форк списка = «Create a new fork» на GitHub: диалог задаёт имя (по умолчанию slug
 *  источника — у тебя он уникален) и опциональное описание; авто-суффикса `-fork`
 *  больше нет. Свой список форкнуть нельзя (у своих вместо Fork — Pin). */
export async function forkTemplate(templateId: string, opts?: { name?: string; description?: string }): Promise<ForkResult | void> {
  const session = await requireSession()
  const src = await db.query.templates.findFirst({
    where: (t) => eq(t.id, templateId),
    with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
  })
  if (!src) return { error: 'Список не найден.' }
  // Нельзя форкнуть собственный список (как на GitHub свой репозиторий не форкается).
  if (src.ownerId === session.userId) return { error: 'Нельзя форкнуть собственный список.' }
  // Видимость: форк раскрывает ВСЁ содержимое (шаги/команды) — чужой приватный/скрытый
  // модерацией форкнуть нельзя (иначе любой залогиненный склонировал бы приватку по id).
  if (!canViewList(src, { isOwner: false })) return { error: 'Список недоступен.' }

  // Дедуп: один аккаунт = один форк списка (как личный аккаунт GitHub) → ведём на существующий.
  const [existingFork] = await db
    .select({ slug: templates.slug })
    .from(templates)
    .where(and(eq(templates.ownerId, session.userId), eq(templates.forkedFromId, src.id)))
    .limit(1)
  if (existingFork) redirect(`/${session.handle}/${existingFork.slug}`)

  if (!(await listQuota(session.userId, session.handle)).ok) redirect(`/${session.handle}?e=list_quota`)

  // Имя из диалога → slug (по умолчанию slug источника). Авто-суффикса нет: занятое имя = ошибка
  // (диалог проверяет доступность вживую через forkNameStatus, сервер валидирует ещё раз).
  const slug = slugify(opts?.name?.trim() || src.slug)
  const [taken] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.ownerId, session.userId), eq(templates.slug, slug)))
    .limit(1)
  if (taken) return { error: 'У вас уже есть список с таким именем — выберите другое.' }

  // Описание из диалога (опц.) переопределяет на языке зрителя; пустое — наследуем от источника.
  const descOverride = opts?.description?.trim()
  const desc = descOverride ? { ...((src.desc as LocaleText | null) ?? {}), [await getLang()]: descOverride } : src.desc

  const srcCurrent = src.versions.find((v) => v.version === src.currentVersion) ?? src.versions[0]
  const srcSteps = srcCurrent
    ? await db.select().from(steps).where(eq(steps.versionId, srcCurrent.id)).orderBy(asc(steps.n))
    : []
  const forked = await listStore.create({
    ownerId: session.userId,
    slug,
    title: src.title,
    desc,
    tags: src.tags,
    ordered: src.ordered,
    visibility: src.visibility,
    status: 'published',
    origin: 'forked',
    forkedFromId: src.id,
    note: `forked from ${src.slug} v${srcCurrent?.version ?? 1}`,
    steps: srcSteps.map((s, i) => ({
      n: i + 1,
      type: s.type ?? 'step', // блочная модель: копия не должна терять text/image блоки
      content: s.content ?? {},
      title: s.title,
      desc: s.desc,
      command: s.command,
      level: s.level,
      why: s.why,
      section: s.section,
      subtasks: s.subtasks,
      refs: s.refs,
      imageRef: s.imageKey ?? null,
    })),
  })

  await db
    .update(templates)
    .set({ forksCount: sql`${templates.forksCount} + 1` })
    .where(eq(templates.id, src.id))
  await notify({ recipientId: src.ownerId, actorId: session.userId, type: 'fork', templateId: src.id })
  if (src.visibility === 'public') await gateListPublication(forked.id) // форк — тоже публикация
  await enqueueReindex(forked.id)

  revalidatePath('/explore')
  redirect(`/${session.handle}/${slug}`)
}
