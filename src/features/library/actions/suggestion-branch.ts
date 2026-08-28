'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, suggestions } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { notify } from '@/features/notifications/notify'
import { isCollaborator } from '@/features/collab/queries'
// eslint-disable-next-line boundaries/dependencies -- гейт «нерешённые обсуждения» живёт с комментариями
import { currentRevision, ensureBranchSuggestion, mergeSuggestion, reviewGates } from '../suggestion-core'
import { closeLinkedIssues, notifyWatchersNewVersion } from '../suggestion-side-effects'
import { enqueueReindex } from '../jobs'
import { recheckList } from '@/features/moderation/moderate-list'
import { gitPort, ownerHandle } from './shared'
import { withPrDefaults } from '../pr-settings'

/**
 * Предложение ИЗ ВЕТКИ: открыть, подтянуть main, влить — в том числе с ручным
 * разрешением конфликтов.
 *
 * Причина измениться одна: как правка, живущая в git, доезжает до main.
 */

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
  const prs = withPrDefaults(tpl.prSettings)
  const owner = await ownerHandle(tpl.ownerId)
  const path = `/${owner}/${tpl.slug}/suggestions/${sug.id}`

  // Ворота — через ОБЩИЙ набор, а не своим списком. Резолвер конфликтов тоже пишет в
  // main, поэтому пропустить здесь хоть одни значило бы дать обход: собери конфликт —
  // и требуемые одобрения больше не нужны. Раньше те же четверо ворот были выписаны
  // здесь копией — ровно то, ради чего заведён `reviewGates` («правило должно быть
  // одно — иначе настройка работает у одного вида предложений и молча не работает у
  // другого»). Копия успела разойтись с оригиналом в главном: она МОЛЧА возвращалась.
  // Человек нажимал «Применить разрешение конфликтов» и не получал ничего — ни
  // результата, ни причины, — тогда как обычное слияние причину называет.
  const blocked = await reviewGates(sug, prs, await currentRevision(sug))
  if (blocked) redirect(`${path}?e=${encodeURIComponent(blocked)}`)
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
