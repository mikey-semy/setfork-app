// Слияние предложения. Причина измениться одна: что должно случиться, чтобы
// правка стала частью списка.

import 'server-only'
import { eq } from 'drizzle-orm'
import { db, suggestions, users } from '@/shared/db'
import { findDestructiveSteps } from '@/core/domain/destructive-command'
import { suggestionBlocks } from '../suggestion-blocks'
import { enqueueReindex } from '../jobs'
import { withPrDefaults } from '../pr-settings'
import { closeLinkedIssues, notifyWatchersNewVersion } from '../suggestion-side-effects'
// eslint-disable-next-line boundaries/dependencies -- уведомление автору правки: тот же кросс-фич-паттерн, что в actions.ts
import { notify } from '@/features/notifications/notify'
// eslint-disable-next-line boundaries/dependencies -- права коллаборатора живут в collab
import { isCollaborator } from '@/features/collab/queries'
// eslint-disable-next-line boundaries/dependencies -- перепроверка модерацией после слияния мимо listStore
import { recheckList } from '@/features/moderation/moderate-list'
import { applySuggestion } from './apply'
import { reviewGates } from './gates'
import { currentRevision } from './revision'
import { gitPort } from './git-port'

/**
 * ЯДРО СЛИЯНИЯ предложения — без сессии и без редиректа.
 *
 * Одно на оба вида: предложение из ВЕТКИ вливается git-слиянием, предложение из
 * пунктов принимается как новая версия (applySuggestion). Вызывающему не нужно
 * знать, какое из них перед ним, — а гейты в любом случае одни.
 *
 * Причина отказа возвращается кодом, а не текстом: страница по нему строит адрес
 * `?e=<код>`, MCP отдаёт его агенту как есть. Раньше коды жили в экшене, и второй
 * вызывающий неизбежно завёл бы свой набор.
 */
export async function mergeSuggestion(
  suggestionId: string,
  actorUserId: string,
): Promise<{ ok: true; owner: string; slug: string; kind: 'branch' | 'items'; version?: number } | { ok: false; reason: string }> {
  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
  if (!sug) return { ok: false, reason: 'not found' }
  if (sug.status !== 'open') return { ok: false, reason: `already ${sug.status}` }

  // Предложение из пунктов — принимается созданием версии; там свои же гейты.
  if (!sug.branchRef) {
    const res = await applySuggestion(suggestionId, actorUserId)
    if (!res.ok) return res
    // Какой версией стала правка — иначе откат гадал бы по времени и тексту заметки.
    await db.update(suggestions).set({ mergedVersion: res.version }).where(eq(suggestions.id, suggestionId))
    const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, sug.template.ownerId))
    return { ok: true, owner: u?.handle ?? '', slug: res.slug, kind: 'items', version: res.version }
  }

  const tpl = sug.template
  if (tpl.ownerId !== actorUserId && !(await isCollaborator(tpl.id, actorUserId))) return { ok: false, reason: 'not a maintainer' }

  // Ворота — по настройкам списка (раздел «Предложения»), а не захардкожены, и те же
  // самые, что у принятия из пунктов.
  const prs = withPrDefaults(tpl.prSettings)
  const blocked = await reviewGates(sug, prs, await currentRevision(sug))
  if (blocked) return { ok: false, reason: blocked }

  const [ownerRow] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, tpl.ownerId))
  const owner = ownerRow?.handle ?? ''
  const { gitCore, BranchOpError } = await gitPort()
  let mergedVersion: number | null = null

  // Страж исполняемого выхода на пути СЛИЯНИЯ. Он стоит в фасаде записи версии, но
  // слияние ветки создаёт версию в самом ядре и фасад минует: посторонний вкладчик
  // мог положить исполняемую команду в ветку, а владелец влить её одной кнопкой — и
  // она уезжает в исполняемый /raw. Содержимое берём тем же способом, что и просмотр
  // предложения, чтобы проверять ровно то, что вольётся.
  const incoming = await suggestionBlocks(sug, owner, tpl.slug)
  const destructive = findDestructiveSteps(incoming)
  if (destructive.length) {
    const { index, match } = destructive[0]
    return { ok: false, reason: `destructive command in step ${index + 1} (${match.reason})` }
  }

  // Линейная история: сливаем только когда это fast-forward. Проверяем ДО merge —
  // иначе merge-коммит уже создан, и «запрет» опоздал.
  if (prs.linearOnly) {
    const state = await gitCore.mergeState({ owner, slug: tpl.slug }, sug.branchRef).catch(() => null)
    if (state && state.mergeBaseSha !== state.ours.tipSha) return { ok: false, reason: 'not-linear' }
  }

  try {
    // Заголовок squash-коммита — «<название предложения> (#N)»: по нему в истории
    // main видно, откуда изменение, когда самой ветки уже нет.
    const head = sug.note.split(/\r?\n/)[0].trim().slice(0, 120)
    const title = sug.number ? `${head || sug.branchRef} (#${sug.number})` : head || sug.branchRef
    const merged = await gitCore.mergeBranch({ owner, slug: tpl.slug }, sug.branchRef, { mode: prs.mergeMethod, message: title })
    mergedVersion = merged.newVersion
  } catch (e) {
    return { ok: false, reason: e instanceof BranchOpError ? e.code : 'internal' }
  }

  // Ветка после слияния не нужна — удаляем, если так настроено. Ошибку глотаем:
  // предложение уже влито, и падать из-за уборки нельзя.
  if (prs.autoDeleteBranch) await gitCore.deleteBranch({ owner, slug: tpl.slug }, sug.branchRef).catch(() => {})

  await db.update(suggestions).set({ status: 'accepted', resolvedAt: new Date(), mergedVersion }).where(eq(suggestions.id, sug.id))
  await closeLinkedIssues(tpl.id, sug.note, actorUserId, prs.autoCloseIssues)
  await notify({ recipientId: sug.authorId, actorId: actorUserId, type: 'suggestion_accepted', templateId: tpl.id, suggestionId: sug.id })
  // git-merge создаёт версию МИМО listStore.addVersion → фасадный барьер её не ловит.
  if (tpl.visibility === 'public') await recheckList(tpl.id)
  await notifyWatchersNewVersion(tpl.id, actorUserId)
  await enqueueReindex(tpl.id)
  // Версия отдаётся и здесь. Она вычислена ядром и уже записана в `mergedVersion`, но
  // наружу уходила только у предложения из ПУНКТОВ: MCP печатал `version: undefined`
  // при слиянии ветки и число — при принятии из пунктов, хотя действие одно и то же.
  // Агент по такому ответу не мог сказать, во что влилась правка.
  return { ok: true, owner, slug: tpl.slug, kind: 'branch', version: mergedVersion ?? undefined }
}
