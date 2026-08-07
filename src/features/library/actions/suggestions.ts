'use server'

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  blockComments,
  blockCommentThreads,
  db,
  issues,
  steps,
  suggestionAssignees,
  suggestionComments,
  suggestionReviews,
  suggestions,
  templates,
  users,
  type ProposedItem,
} from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { recordAudit } from '@/shared/audit'
import { captureError } from '@/shared/observability'
import { getLang } from '@/shared/i18n/server'
import { tr, type Lang, type LocaleText } from '@/shared/i18n'
import { rateLimit } from '@/shared/rate-limit'
import { textLang } from '@/shared/i18n/detect-text-lang'
import { toStepInput } from '@/shared/lib/step-input'
import { notify, notifyMany, notifyMentions } from '@/features/notifications/notify'
import { ensureWatch } from '@/features/watch/actions'
import { getWatcherIds } from '@/features/watch/queries'
import { isCollaborator } from '@/features/collab/queries'
import { collabStore, suggestionCommenterIds } from '@/features/collab-store/store'
// eslint-disable-next-line boundaries/dependencies -- гейт «нерешённые обсуждения» живёт с комментариями
import { countUnresolvedThreads } from '@/features/comments/queries'
import { canEditList, canViewList } from '@/core'
import { DestructiveCommandError } from '@/core/domain/destructive-command'
import { parseEditorItems, toProposedItems } from '../editor'
import { getVersionSteps } from '../queries'
import { countApprovals, hasBlockingReview } from '../review-queries'
import { listStore } from '../list-store'
import { closingRefs } from '../closing-refs'
import { canEditSuggestionItems } from '../suggestion-perms'
import { applySuggestion, checksGate, currentRevision, ensureBranchSuggestion, mergeSuggestion } from '../suggestion-core'
import { closeLinkedIssues, notifyWatchersNewVersion } from '../suggestion-side-effects'
import { suggestionBlocks } from '../suggestion-blocks'
import { applyFieldValue } from '../suggestion-apply'
import { enqueueReindex } from '../jobs'
import { recheckList } from '@/features/moderation/moderate-list'
import { gitPort, ownerHandle } from './shared'
import { withPrDefaults } from '../pr-settings'

/**
 * Предложения правок: подача, ветка-PR, обновление из main, слияние (в том числе с
 * ручным разрешением конфликтов), обсуждение и применение отдельных правок.
 *
 * Самая крупная зона библиотеки и самая связная: всё здесь про путь чужой правки от
 * подачи до версии. Держать её вместе с настройками списка и загрузками файлов
 * означало, что правка любого из трёх сюжетов открывает один и тот же файл.
 */

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
  // Создание/поиск — общей частью с магическим пушем refs/for/main (Ф4):
  // нумерация, подписка и уведомление обязаны совпадать у обоих путей.
  // Повторное «Открыть предложение» ведёт на существующее.
  const { id } = await ensureBranchSuggestion({
    templateId: tpl.id,
    ownerId: tpl.ownerId,
    currentVersion: tpl.currentVersion,
    authorId: session.userId,
    branch,
  })
  redirect(`/${owner}/${tpl.slug}/suggestions/${id}`)
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

  const [{ gitCore, BranchOpError }, { threeWayMerge, applyChoices }] = await Promise.all([
    gitPort(),
    import('@/features/git/three-way'),
  ])

  const state = await gitCore.mergeState({ owner, slug: tpl.slug }, sug.branchRef).catch(() => null)
  if (!state) redirect(`${path}?e=not-found`)
  const res = threeWayMerge(state.base, state.ours, state.theirs)
  const final = applyChoices(res, stepChoices, metaChoices)
  if (!final) redirect(`${path}?e=unresolved`) // выбраны не все конфликты (или state изменился)

  // Отдаём СОДЕРЖИМОЕ — канонический list.json собирает ядро (владелец формата).
  // Раньше здесь строился готовый файл, из-за чего правила формата приходилось
  // знать и клиенту тоже (HQ tracks/git-format.md, Ф0a).
  const content = {
    title: final.title,
    desc: final.desc,
    tags: final.tags,
    ordered: final.ordered,
    version: tpl.currentVersion + 1,
    steps: final.steps.map((s, i) => ({ ...s, n: i + 1 })),
  }

  try {
    // Способ слияния — тот же, что у обычного пути: список, настроенный на squash, не
    // должен получать историю ветки только потому, что случился конфликт.
    const head = sug.note.split(/\r?\n/)[0].trim().slice(0, 120)
    await gitCore.mergeResolved({ owner, slug: tpl.slug }, sug.branchRef, content, {
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
    const { gitCore, BranchOpError } = await gitPort()
    const snap = await gitCore.branchSnapshot({ owner, slug: tpl.slug }, sug.branchRef).catch(() => null)
    if (!snap) return 'not-found'
    // Содержимое версии, а не готовый файл: канон собирает ядро (владелец формата).
    const content = {
      title: snap.title,
      desc: snap.desc,
      tags: snap.tags,
      ordered: snap.ordered,
      version: tpl.currentVersion + 1,
      steps: proposed.map((it, i) => ({
        n: i + 1,
        ...(it.type && it.type !== 'step' ? { type: it.type, content: (it.content ?? {}) as Record<string, unknown> } : {}),
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
    }
    try {
      // expectedTip — снапшот, который правил человек: если ветку подвинули, пишем
      // не поверх чужого пуша, а честно отказываем.
      await gitCore.commitToBranch({ owner, slug: tpl.slug }, sug.branchRef, content, {
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
