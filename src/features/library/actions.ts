'use server'

import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { blockComments, blockCommentThreads, db, issues, steps, suggestionAssignees, suggestionComments, suggestionReviews, suggestions, templates, users, type ProposedItem } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { recordAudit } from '@/shared/audit'
import { captureError } from '@/shared/observability'
import { getLang } from '@/shared/i18n/server'
import { isLang, langEnName, tr, type Lang, type LocaleText } from '@/shared/i18n'
import { imageUrl, uploadAttachmentFile, uploadImageFile, uploadVideoFile } from '@/shared/media'
import { generateChangeNote, generateListRefine, generateListTranslation } from '@/shared/ai/generate'
import { checkRateLimit } from '@/shared/ai/rate-limit'
import { rateLimit } from '@/shared/rate-limit'
import { fetchPublicUrl } from '@/shared/lib/safe-fetch'
import { aiQuota, listQuota } from '@/shared/quota'
import { textLang } from '@/shared/i18n/detect-text-lang'
import { notify, notifyMany, notifyMentions } from '@/features/notifications/notify'
import { enqueueReindex } from './jobs'
import { ensureWatch } from '@/features/watch/actions'
import { getWatcherIds } from '@/features/watch/queries'
import { isCollaborator } from '@/features/collab/queries'
import { curationStore } from '@/features/curation/store'
import { collabStore, suggestionCommenterIds } from '@/features/collab-store/store'
import { gateListPublication, recheckList } from '@/features/moderation/moderate-list'
import { toStepInput } from '@/shared/lib/step-input'
import { parseEditorItems, toProposedItems, type EditorItem } from './editor'
import { getVersionSteps } from './queries'
import { countApprovals, hasBlockingReview } from './review-actions'
// eslint-disable-next-line boundaries/dependencies -- гейт «нерешённые обсуждения» живёт с комментариями
import { countUnresolvedThreads } from '@/features/comments/queries'
import { listStore } from './list-store'
import { closingRefs } from './closing-refs'
import { withPrDefaults, PR_BOOL_KEYS, type PrBoolKey } from './pr-settings'
import { canEditSuggestionItems } from './suggestion-perms'
import { applySuggestion, checksGate, currentRevision, mergeSuggestion } from './suggestion-core'
import { closeLinkedIssues, notifyWatchersNewVersion } from './suggestion-side-effects'
import { suggestionBlocks } from './suggestion-blocks'
import { applyFieldValue } from './suggestion-apply'
import { parseTags, slugify } from './slug'
import { registerTags } from '@/features/tags/service'
import { canEditList, canViewList } from '@/core'

/**
 * Ленивый доступ к git-порту, его ошибкам и канонической сериализации.
 *
 * Импорт динамический не ради красоты: серверные экшены этого файла в большинстве
 * своём git не трогают, а порт тянет за собой ядро. Один помощник вместо копии
 * этих импортов в каждом git-экшене (их уже пять).
 *
 * `listJson` идёт отсюда же намеренно: это ЕДИНСТВЕННОЕ место файла, знающее про
 * `features/git`. Каждый новый прямой импорт туда — ещё одно кросс-фичевое
 * нарушение границ, а их счётчик в baseline линтера ограничен: превысишь — и он
 * начинает сыпать по всему файлу разом.
 */
async function gitPort() {
  const [core, ports, ser] = await Promise.all([
    import('@/features/git/core'),
    import('@/core'),
    import('@/features/git/serialize'),
  ])
  return { gitCore: core.gitCore, BranchOpError: ports.BranchOpError, listJson: ser.listJson }
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
  // Настройка списка «кто может предлагать»: аналог Creation allowed by у GitHub.
  // Владелец может предлагать всегда — иначе он запирал бы сам себя.
  const prs = withPrDefaults(tpl.prSettings)
  if (prs.allowFrom === 'collaborators' && tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) {
    redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}?e=suggest-closed`)
  }
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
      number: sql`(select coalesce(max(number), 0) + 1 from suggestions where template_id = ${tpl.id})`,
    })
    .returning({ id: suggestions.id })
  await ensureWatch(tpl.id)
  if (tpl.ownerId !== session.userId) {
    await notify({ recipientId: tpl.ownerId, actorId: session.userId, type: 'suggestion_new', templateId: tpl.id, suggestionId: created.id })
  }
  redirect(`/${owner}/${tpl.slug}/suggestions/${created.id}`)
}

/**
 * Влить main в ветку предложения («обновить ветку»).
 *
 * Нужно, когда main ушёл вперёд: без этого единственный выход из расхождения —
 * ручной резолвер конфликтов, хотя обычно достаточно обратного слияния. Версию не
 * создаёт: main не двигается.
 */
export async function updateBranchFromMain(suggestionId: string): Promise<void> {
  const session = await requireSession()
  const sug = await db.query.suggestions.findFirst({
    where: (s) => eq(s.id, suggestionId),
    with: { template: true },
  })
  if (!sug || sug.status !== 'open' || !sug.branchRef) return
  const tpl = sug.template
  // Обновлять ветку может автор предложения (это его ветка) или тот, кто может пушить.
  const can =
    session.userId === sug.authorId ||
    tpl.ownerId === session.userId ||
    (await isCollaborator(tpl.id, session.userId))
  if (!can) return

  const owner = await ownerHandle(tpl.ownerId)
  const path = `/${owner}/${tpl.slug}/suggestions/${sug.number ?? sug.id}`
  const { gitCore, BranchOpError } = await gitPort()
  try {
    await gitCore.updateBranch({ owner, slug: tpl.slug }, sug.branchRef)
  } catch (e) {
    const code = e instanceof BranchOpError ? e.code : 'internal'
    redirect(`${path}?e=${code}`)
  }
  revalidatePath(path)
}

/**
 * Владелец/коллаборатор: влить предложение.
 *
 * Гейты и само слияние живут в ядре (`suggestion-core`): его же зовёт MCP, и
 * второй набор проверок здесь неизбежно разошёлся бы с первым. Экшен делает то,
 * чего ядро не умеет и не должно: берёт сессию и ведёт человека — с кодом отказа
 * в адресе, как было.
 */
export async function mergeBranchPr(suggestionId: string): Promise<void> {
  const session = await requireSession()
  const res = await mergeSuggestion(suggestionId, session.userId)
  if (!res.ok) {
    // Куда вести с ошибкой, знает только страница — ядру адреса не нужны.
    const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
    if (!sug) return
    const owner = await ownerHandle(sug.template.ownerId)
    redirect(`/${owner}/${sug.template.slug}/suggestions/${sug.number ?? sug.id}?e=${encodeURIComponent(res.reason)}`)
  }
  revalidatePath('/', 'layout')
  redirect(`/${res.owner}/${res.slug}`)
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
  if (sug.draft) return // резолвер конфликтов тоже завершается слиянием — см. mergeBranchPr
  const tpl = sug.template
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return
  // Гейты — ВСЕ те же, что у обычного слияния. Резолвер конфликтов тоже пишет в
  // main, поэтому пропустить здесь хоть один значило бы дать обход: собери конфликт
  // — и требуемые одобрения больше не нужны.
  const prs = withPrDefaults(tpl.prSettings)
  if (await hasBlockingReview(sug.id)) return
  if (prs.blockOnUnresolved && (await countUnresolvedThreads(sug.id))) return
  if (prs.requiredApprovals > 0 && (await countApprovals(sug.id)) < prs.requiredApprovals) return
  // Внешние проверки — ТОТ ЖЕ гейт, что у обычного слияния. Резолвер конфликтов тоже
  // пишет в main: без этой строки достаточно было собрать конфликт, и упавшая проверка
  // переставала держать. Ровно та же дыра, что и с остальными гейтами выше.
  if (await checksGate(sug.id, prs.blockOnFailedChecks, await currentRevision(sug))) return

  const owner = await ownerHandle(tpl.ownerId)
  const path = `/${owner}/${tpl.slug}/suggestions/${sug.id}`
  // Линейная история: разрешение конфликтов создаёт merge-коммит по определению, а
  // значит при этой настройке путь закрыт — сначала «Обновить из main», потом ff.
  // Текст ошибки `not-linear` ровно это и советует.
  if (prs.linearOnly) redirect(`${path}?e=not-linear`)

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

  const [{ gitCore, BranchOpError, listJson }, { threeWayMerge, applyChoices }] = await Promise.all([
    gitPort(),
    import('@/features/git/three-way'),
  ])

  const state = await gitCore.mergeState({ owner, slug: tpl.slug }, sug.branchRef).catch(() => null)
  if (!state) redirect(`${path}?e=not-found`)
  const res = threeWayMerge(state.base, state.ours, state.theirs)
  const final = applyChoices(res, stepChoices, metaChoices)
  if (!final) redirect(`${path}?e=unresolved`) // выбраны не все конфликты (или state изменился)

  // Каноничный формат list.json — ТОЙ ЖЕ функцией, что пишет версии в git:
  // собранный руками JSON молча разошёлся бы с ней при первой правке формата.
  const json = listJson({
    title: final.title,
    desc: final.desc,
    tags: final.tags,
    ordered: final.ordered,
    version: tpl.currentVersion + 1,
    // blockId у трёхстороннего merge — nullable; сериализатор пишет поле только
    // когда оно есть (иначе ломается golden-паритет с Rust), поэтому null убираем.
    steps: final.steps.map(({ blockId, ...s }, i) => ({ ...s, n: i + 1, ...(blockId ? { blockId } : {}) })),
  })

  try {
    // Способ слияния — тот же, что у обычного пути: список, настроенный на squash, не
    // должен получать историю ветки только потому, что случился конфликт.
    const head = sug.note.split(/\r?\n/)[0].trim().slice(0, 120)
    await gitCore.mergeResolved({ owner, slug: tpl.slug }, sug.branchRef, json, {
      mode: prs.mergeMethod,
      message: sug.number ? `${head || sug.branchRef} (#${sug.number})` : head || sug.branchRef,
    })
  } catch (e) {
    const code = e instanceof BranchOpError ? e.code : 'internal'
    redirect(`${path}?e=${code}`)
  }
  await db.update(suggestions).set({ status: 'accepted', resolvedAt: new Date() }).where(eq(suggestions.id, sug.id))
  // «closes #12» в тексте предложения закрывает задачу — но только теперь, когда
  // изменения действительно в main.
  await closeLinkedIssues(tpl.id, sug.note, session.userId, prs.autoCloseIssues)
  if (sug.authorId !== session.userId) {
    await notify({ recipientId: sug.authorId, actorId: session.userId, type: 'suggestion_accepted', templateId: tpl.id, suggestionId: sug.id })
  }
  // git-merge создаёт версию МИМО listStore.addVersion → фасадный барьер её не ловит, recheck явно.
  if (tpl.visibility === 'public') await recheckList(tpl.id)
  await notifyWatchersNewVersion(tpl.id, session.userId)
  await enqueueReindex(tpl.id)
  revalidatePath('/', 'layout')
  redirect(`/${owner}/${tpl.slug}`)
}

export async function acceptSuggestion(suggestionId: string): Promise<void> {
  const session = await requireSession()
  const res = await applySuggestion(suggestionId, session.userId)
  if (!res.ok) return
  revalidatePath('/', 'layout')
  redirect(`/${session.handle}/${res.slug}`)
}

// ── Обсуждение предложения (review-комментарии) ──────────────────────
/**
 * Переименовать правку (заголовок PR = её сообщение).
 *
 * Право: автор правки или владелец списка — как в GitHub, где заголовок PR
 * правят и автор, и мейнтейнер. Пустой заголовок не принимаем: у правки должно
 * остаться человеческое имя, иначе список PR превращается в «(без описания)».
 */
export async function editSuggestionNote(suggestionId: string, note: string): Promise<{ ok: boolean }> {
  const session = await requireSession()
  const text = note.trim().slice(0, 300)
  if (!text) return { ok: false }

  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
  if (!sug) return { ok: false }
  if (sug.authorId !== session.userId && sug.template.ownerId !== session.userId) return { ok: false }

  await db.update(suggestions).set({ note: text }).where(eq(suggestions.id, suggestionId))
  const handle = await ownerHandle(sug.template.ownerId)
  revalidatePath(`/${handle}/${sug.template.slug}/suggestions/${sug.number ?? sug.id}`)
  return { ok: true }
}

// Правило прав живёт в suggestion-perms (без 'use server'): каждый экспорт
// отсюда — сетевая точка входа, а предикату быть вызываемым снаружи незачем.

/**
 * ПРАВКА ПУНКТОВ предложения после создания — то, чего не было вовсе.
 *
 * До сих пор `suggestions.items` записывались ровно один раз, при создании: ни
 * второй человек не мог внести вклад, ни сам автор — поправить опечатку. На
 * GitHub на правку просто дописывают коммит; у нас пути не было.
 *
 * Один вход на оба вида предложений — разница только в том, где живут пункты:
 * у ветки это `list.json` в её tip (пишем коммитом, авторство человека
 * сохраняется в git), у старых предложений — колонка в БД.
 */
export async function updateSuggestionItems(suggestionId: string, formData: FormData): Promise<void> {
  const session = await requireSession()
  const lang = await getLang()
  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
  if (!sug || sug.status !== 'open') return
  if (!(await canEditSuggestionItems(sug, session.userId))) return
  const tpl = sug.template
  if (!canEditList(tpl)) return // архив/заморозка — список только на чтение

  const proposed = toProposedItems(parseEditorItems(formData.get('items')), lang)
  const err = await writeSuggestionItems(sug, proposed, session, lang, `Update suggestion by @${session.handle}`)
  const owner = await ownerHandle(tpl.ownerId)
  const path = `/${owner}/${tpl.slug}/suggestions/${sug.number ?? sug.id}`
  if (err) redirect(`${path}?e=${err}`)
  revalidatePath(path)
  redirect(path)
}

/**
 * ЗАПИСЬ предложенных пунктов — общая для правки редактором и для «применить
 * предложенную правку».
 *
 * Разница между видами предложений только в том, ГДЕ живут пункты: у ветки это
 * `list.json` в её tip, у старых — колонка БД. Два вызывающих не должны знать
 * этой развилки по отдельности, иначе один из них рано или поздно забудет про
 * ветку (ровно так комментарии к пунктам не создавались на branch-PR).
 *
 * Возвращает код ошибки для `?e=`, либо null при успехе.
 */
async function writeSuggestionItems(
  sug: { id: string; authorId: string; branchRef: string | null; coauthorIds: unknown; template: { id: string; ownerId: string; slug: string; currentVersion: number } },
  proposed: ProposedItem[],
  session: { userId: string; handle: string },
  lang: Lang,
  message: string,
): Promise<string | null> {
  const tpl = sug.template
  const owner = await ownerHandle(tpl.ownerId)

  if (sug.branchRef) {
    // Пункты ветки живут в git. Базу берём из снапшота: заголовок/теги/порядок
    // принадлежат ветке, а не БД, и перетирать их правкой пунктов нельзя.
    const { gitCore, BranchOpError, listJson } = await gitPort()
    const snap = await gitCore.branchSnapshot({ owner, slug: tpl.slug }, sug.branchRef).catch(() => null)
    if (!snap) return 'not-found'
    const json = listJson({
      title: snap.title,
      desc: snap.desc,
      tags: snap.tags,
      ordered: snap.ordered,
      version: tpl.currentVersion + 1,
      steps: proposed.map((it, i) => ({
        n: i + 1,
        ...(it.type && it.type !== 'step' ? { type: it.type, content: (it.content ?? {}) as Record<string, unknown> } : {}),
        // blockId только когда он есть: строки без него дают байт-в-байт прежний
        // list.json, и golden-паритет с Rust не ломается (см. serialize.ts).
        ...(it.blockId ? { blockId: String(it.blockId) } : {}),
        title: tr(it.title as LocaleText, lang),
        desc: tr(it.desc as LocaleText, lang),
        command: it.command ?? '',
        level: it.level ?? 'required',
        why: tr(it.why as LocaleText, lang),
        section: tr(it.section as LocaleText, lang),
        subtasks: (it.subtasks ?? []).map((s) => tr(s as LocaleText, lang)),
        refs: (it.refs ?? []).map((r) => ({ label: tr(r.label as LocaleText, lang), ...(r.url ? { url: r.url } : {}) })),
      })),
    })
    try {
      // expectedTip — снапшот, который правил человек: если ветку подвинули, пишем
      // не поверх чужого пуша, а честно отказываем.
      await gitCore.commitToBranch({ owner, slug: tpl.slug }, sug.branchRef, json, {
        message,
        expectedTip: snap.tipSha,
        author: { name: session.handle, email: gitEmail(session.handle) },
      })
    } catch (e) {
      return e instanceof BranchOpError ? e.code : 'internal'
    }
  } else {
    await db.update(suggestions).set({ items: proposed }).where(eq(suggestions.id, sug.id))
  }

  // СОДЕРЖИМОЕ ИЗМЕНИЛОСЬ → прежние одобрения к нему не относятся. Рецензент
  // одобрял то, что читал; без сброса автор мог дождаться нужного числа одобрений,
  // подменить пункты и слить непроверенное — гейт «нужно N одобрений» становился
  // формальностью. Так же поступает GitHub с dismiss stale reviews.
  //
  // Снимаем ТОЛЬКО «одобряю»: «просит доработать» относится к самой правке, и
  // стирать его правкой значило бы дать обход блокировки — достаточно было бы
  // тронуть пункт. Комментарии тоже остаются: они не гейт.
  await db
    .delete(suggestionReviews)
    .where(and(eq(suggestionReviews.suggestionId, sug.id), eq(suggestionReviews.verdict, 'approve')))

  // Соавторство: правку внёс не автор — запоминаем, иначе вклад исчезнет
  // (у ветки он остался бы в git, у items — нигде).
  if (sug.authorId !== session.userId) {
    const prev = (sug.coauthorIds as string[] | null) ?? []
    if (!prev.includes(session.userId)) {
      await db.update(suggestions).set({ coauthorIds: [...prev, session.userId] }).where(eq(suggestions.id, sug.id))
    }
    await notify({
      recipientId: sug.authorId,
      actorId: session.userId,
      type: 'suggestion_edited',
      templateId: tpl.id,
      suggestionId: sug.id,
    })
  }
  return null
}

/**
 * ПРИМЕНИТЬ предложенную правку пункта одной кнопкой.
 *
 * Наш случай сильнее, чем у GitHub: там suggested change — патч строк файла, и он
 * рассыпается, стоит строкам уехать. У нас тред знает БЛОК (устойчивая
 * идентичность, ADR-0013) и ПОЛЕ, поэтому применение — это подстановка значения:
 * пункт можно было переставить, переименовать соседей — правка всё равно ляжет
 * туда, куда задумано.
 *
 * Право — то же, что у правки пунктов: применяет тот, кто и так мог бы вписать
 * этот текст руками.
 */
export async function applySuggestedEdit(commentId: string): Promise<void> {
  const session = await requireSession()
  const lang = await getLang()
  const [row] = await db
    .select({
      suggestedText: blockComments.suggestedText,
      appliedAt: blockComments.appliedAt,
      pending: blockComments.pending,
      threadId: blockCommentThreads.id,
      blockId: blockCommentThreads.blockId,
      field: blockCommentThreads.field,
      suggestionId: blockCommentThreads.suggestionId,
    })
    .from(blockComments)
    .innerJoin(blockCommentThreads, eq(blockCommentThreads.id, blockComments.threadId))
    .where(eq(blockComments.id, commentId))
    .limit(1)
  // Черновик ещё никому не показан — применять нечего.
  if (!row || row.suggestedText === null || row.appliedAt || row.pending) return

  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, row.suggestionId), with: { template: true } })
  if (!sug || sug.status !== 'open') return
  if (!(await canEditSuggestionItems(sug, session.userId))) return
  const tpl = sug.template
  if (!canEditList(tpl)) return

  const owner = await ownerHandle(tpl.ownerId)
  const path = `/${owner}/${tpl.slug}/suggestions/${sug.number ?? sug.id}`
  // Пункты берём тем же правилом, что и вся страница: у ветки — из tip.
  const items = await suggestionBlocks(sug, owner, tpl.slug)
  const idx = items.findIndex((it) => it.blockId === row.blockId)
  if (idx < 0) redirect(`${path}?e=orphaned`) // блок исчез — применять некуда

  const next = items.map((it, i) => (i === idx ? applyFieldValue(it, row.field, row.suggestedText!, lang) : it))
  const err = await writeSuggestionItems(sug, next, session, lang, `Apply suggestion from @${session.handle}`)
  if (err) redirect(`${path}?e=${err}`)

  // Применили — отмечаем и закрываем тред: обсуждать больше нечего (так же
  // поступает GitHub, и без этого счётчик нерешённых врал бы.)
  await db.update(blockComments).set({ appliedAt: new Date() }).where(eq(blockComments.id, commentId))
  await db
    .update(blockCommentThreads)
    .set({ resolvedAt: new Date(), resolvedById: session.userId })
    .where(eq(blockCommentThreads.id, row.threadId))
  revalidatePath(path)
  redirect(path)
}

/**
 * Адрес для авторства коммита — ВСЕГДА стабильный noreply по нику.
 *
 * Раньше сюда подставлялась почта аккаунта. Список публичный и клонируется целиком:
 * почта уезжала в git-историю навсегда и доставалась любому, кто сделал clone. При
 * этом человек её оставлял для входа и писем, а не для публикации — согласия на
 * публикацию он не давал.
 *
 * Ник и так виден на странице, поэтому авторство остаётся человеческим: `@ник` в
 * имени, стабильный адрес в поле почты. Захочет показать настоящую — это отдельная
 * осознанная настройка, а не поведение по умолчанию.
 */
function gitEmail(handle: string): string {
  return `${handle}@users.noreply.setfork.com`
}

/**
 * Правка своего комментария к предложению.
 *
 * Только автор: чужие реплики не редактирует даже владелец списка — иначе в
 * обсуждении нельзя было бы доверять тому, что написано от чьего-то имени.
 * Пустое тело трактуем как отмену, а не как удаление: удаление — отдельное
 * намерение, и делать его побочным эффектом пустой формы опасно.
 */
export async function editSuggestionComment(commentId: string, body: string): Promise<{ ok: boolean }> {
  const session = await requireSession()
  const text = body.trim().slice(0, 20000)
  if (!text) return { ok: false }

  const [row] = await db
    .select({ authorId: suggestionComments.authorId, suggestionId: suggestionComments.suggestionId })
    .from(suggestionComments)
    .where(eq(suggestionComments.id, commentId))
    .limit(1)
  if (!row || row.authorId !== session.userId) return { ok: false }

  await db
    .update(suggestionComments)
    .set({ body: text, updatedAt: new Date() })
    .where(eq(suggestionComments.id, commentId))

  const sug = await db.query.suggestions.findFirst({ where: (x) => eq(x.id, row.suggestionId), with: { template: true } })
  if (sug) {
    const handle = await ownerHandle(sug.template.ownerId)
    revalidatePath(`/${handle}/${sug.template.slug}/suggestions/${sug.number ?? sug.id}`)
  }
  return { ok: true }
}

export async function addSuggestionComment(formData: FormData): Promise<void> {
  const session = await requireSession()
  const suggestionId = String(formData.get('suggestionId') ?? '')
  const body = String(formData.get('body') ?? '').trim().slice(0, 20000)
  const sug = await db.query.suggestions.findFirst({
    where: (s) => eq(s.id, suggestionId),
    with: { template: true },
  })
  if (!sug) return
  // Заперто — новых реплик нет ни у кого, включая владельца: замок, который
  // обходит тот, кто его повесил, ничего не значит для остальных.
  if (sug.lockedAt) return
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
    needsHuman: it.needsHuman === true,
    needsHumanAsk: it.needsHumanAsk ?? '',
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
      // ИДЕНТИЧНОСТЬ БЛОКА переносим: перевод — это то же содержимое на другом языке,
      // а не новые пункты. Без blockId следующая версия получала новые id, и всё, что
      // на идентичности держится (привязка обсуждений, отметки «просмотрено», дифф),
      // читало перевод как «всё удалено и всё добавлено» (ADR-0013).
      blockId: s.blockId ?? undefined,
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
      // Пометка «здесь нужен человек» — свойство пункта, а не языка: перевод её не
      // отменяет. Набор шагов переписывается целиком, поэтому не перенести = стереть.
      needsHuman: s.needsHuman,
      needsHumanAsk: s.needsHumanAsk as LocaleText,
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

/**
 * Признак «живой список» (лента). Меняет не вид, а правила: у планки свежесть вместо полноты,
 * никакого «устоялся» и расхождения форком, уход ДОБАВЛЯЕТ новое по теме вместо полировки.
 *
 * Ставит и снимает ЧЕЛОВЕК: список, выросший из события, петля помечает живым сама — но это
 * догадка, и снять её должно быть так же просто, как поставить.
 */
export async function setListLiving(templateId: string, living: boolean): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  await db.update(templates).set({ living }).where(eq(templates.id, templateId))
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

/** Переключить флаг настроек предложений (владелец списка). */
export async function setPrSetting(templateId: string, key: PrBoolKey, on: boolean): Promise<void> {
  const session = await requireSession()
  if (!PR_BOOL_KEYS.includes(key)) return
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  const next = { ...withPrDefaults(tpl.prSettings), [key]: on }
  await db.update(templates).set({ prSettings: next }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

/** Сколько одобрений нужно (0 = не требуются) и кто может предлагать. */
export async function setPrNumber(templateId: string, key: 'requiredApprovals', value: number): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId || key !== 'requiredApprovals') return
  const next = withPrDefaults({ ...withPrDefaults(tpl.prSettings), requiredApprovals: value })
  await db.update(templates).set({ prSettings: next }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

export async function setPrMergeMethod(templateId: string, value: 'merge' | 'squash'): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  const next = withPrDefaults({ ...withPrDefaults(tpl.prSettings), mergeMethod: value })
  await db.update(templates).set({ prSettings: next }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

export async function setPrAllowFrom(templateId: string, value: 'all' | 'collaborators'): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  const next = withPrDefaults({ ...withPrDefaults(tpl.prSettings), allowFrom: value })
  await db.update(templates).set({ prSettings: next }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}
