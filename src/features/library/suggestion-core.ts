import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, suggestionReviews, suggestions, templates, users, type ProposedItem } from '@/shared/db'
import { toStepInput } from '@/shared/lib/step-input'
// eslint-disable-next-line boundaries/dependencies -- уведомления автору и наблюдателям: тот же кросс-фич-паттерн, что в actions.ts
import { notify } from '@/features/notifications/notify'
import { listStore } from './list-store'
import { enqueueReindex } from './jobs'
import { withPrDefaults } from './pr-settings'
import { countApprovals, hasBlockingReview } from './review-queries'
// eslint-disable-next-line boundaries/dependencies -- счётчик нерешённых обсуждений живёт в comments
import { countUnresolvedThreads } from '@/features/comments/queries'
import { blockingReportedChecks } from './suggestion-checks'
import { sql } from 'drizzle-orm'

/**
 * Предложение из ветки: найти открытое или создать.
 *
 * Общая часть ДВУХ путей — кнопки «Открыть предложение» в интерфейсе и
 * магического пуша `refs/for/main` из терминала (Ф4). Вынесена, а не
 * скопирована: нумерация, авто-подписка и уведомление владельца должны
 * совпадать, иначе предложение из терминала окажется второсортным — без номера
 * или без уведомления, и разница вылезет не сразу.
 *
 * Сессии здесь НЕТ намеренно: git-путь авторизован токеном, а не куками, и
 * `authorId` приходит уже проверенным. Поэтому и подписка идёт прямо в стор, а
 * не через `ensureWatch`, который берёт пользователя из сессии.
 *
 * Идемпотентна: повторный вызов на ту же ветку возвращает существующее
 * предложение. На этом держатся ревизии — повторный магический пуш двигает ту же
 * ветку и обновляет ТО ЖЕ предложение, а не плодит новые.
 */
export async function ensureBranchSuggestion(input: {
  templateId: string
  ownerId: string
  currentVersion: number
  authorId: string
  branch: string
  note?: string
}): Promise<{ id: string; created: boolean }> {
  const open = await db.query.suggestions.findFirst({
    where: (s) => and(eq(s.templateId, input.templateId), eq(s.branchRef, input.branch), eq(s.status, 'open')),
  })
  if (open) return { id: open.id, created: false }

  const [row] = await db
    .insert(suggestions)
    .values({
      templateId: input.templateId,
      authorId: input.authorId,
      note: input.note ?? `Merge branch '${input.branch}'`,
      baseVersion: input.currentVersion,
      items: [], // источник правды — tip ветки, материализуется при просмотре
      branchRef: input.branch,
      number: sql`(select coalesce(max(number), 0) + 1 from suggestions where template_id = ${input.templateId})`,
    })
    .returning({ id: suggestions.id })

  await curationStore.ensureWatch(input.templateId, input.authorId)
  if (input.ownerId !== input.authorId) {
    await notify({
      recipientId: input.ownerId,
      actorId: input.authorId,
      type: 'suggestion_new',
      templateId: input.templateId,
      suggestionId: row.id,
    })
  }
  return { id: row.id, created: true }
}

/**
 * Гейт внешних проверок — ОДИН на оба пути слияния.
 *
 * Пути два (ветка и пункты), и правило должно быть одно: иначе «required checks»
 * работали бы у branch-предложений и молча не работали у остальных.
 */
export async function checksGate(suggestionId: string, enabled: boolean, currentRevision?: string | null): Promise<string | null> {
  if (!enabled) return null
  const { failed, pending, stale } = await blockingReportedChecks(suggestionId, currentRevision)
  if (failed.length) return `checks failed: ${failed.join(', ')}`
  if (pending.length) return `checks still running: ${pending.join(', ')}`
  // Проверяли ДРУГУЮ ревизию — держим так же: «проверено» относится к содержимому,
  // а не к предложению вообще.
  if (stale.length) return `checks ran on an older revision: ${stale.join(', ')}`
  return null
}
import { closeLinkedIssues, notifyWatchersNewVersion } from './suggestion-side-effects'
import { canEditList, canViewList } from '@/core'
import { isVerdict } from './review-model'
import { revertPlan } from './suggestion-revert'
import { branchRevision, itemsRevision } from './suggestion-revision'
import { getVersionSteps } from './queries'
import { rateLimit } from '@/shared/rate-limit'
// eslint-disable-next-line boundaries/dependencies -- подписка автора: доменный порт curation, а не экшен (тот берёт сессию)
import { curationStore } from '@/features/curation/store'
// eslint-disable-next-line boundaries/dependencies -- создание правки через доменный порт collab-store
import { collabStore } from '@/features/collab-store/store'
// eslint-disable-next-line boundaries/dependencies -- права коллаборатора живут в collab
import { isCollaborator } from '@/features/collab/queries'
// eslint-disable-next-line boundaries/dependencies -- перепроверка модерацией после слияния мимо listStore
import { recheckList } from '@/features/moderation/moderate-list'

/** Порт git одним местом — как в actions.ts: россыпь импортов рвёт базовый файл boundaries. */
async function gitPort() {
  const [core, ports] = await Promise.all([
    // eslint-disable-next-line boundaries/dependencies -- git-порт: тот же кросс-фич-паттерн, что в actions.ts
    import('@/features/git/core'),
    import('@/core'),
  ])
  return { gitCore: core.gitCore, BranchOpError: ports.BranchOpError }
}

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

  // Черновик не сливается: он ещё не предъявлен к слиянию.
  if (sug.draft) return { ok: false, reason: 'draft' }
  const tpl = sug.template
  if (tpl.ownerId !== actorUserId && !(await isCollaborator(tpl.id, actorUserId))) return { ok: false, reason: 'not a maintainer' }

  // Гейты — по настройкам списка (раздел «Предложения»), а не захардкожены.
  // Запрошенные правки блокируют ВСЕГДА: это не настройка, а смысл ревью.
  const prs = withPrDefaults(tpl.prSettings)
  if (await hasBlockingReview(sug.id)) return { ok: false, reason: 'a reviewer requested changes' }
  if (prs.blockOnUnresolved && (await countUnresolvedThreads(sug.id))) return { ok: false, reason: 'unresolved discussions' }
  if (prs.requiredApprovals > 0 && (await countApprovals(sug.id)) < prs.requiredApprovals)
    return { ok: false, reason: `needs ${prs.requiredApprovals} approval(s)` }
  const checksBlocked = await checksGate(sug.id, prs.blockOnFailedChecks, await currentRevision(sug))
  if (checksBlocked) return { ok: false, reason: checksBlocked }

  const [ownerRow] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, tpl.ownerId))
  const owner = ownerRow?.handle ?? ''
  const { gitCore, BranchOpError } = await gitPort()
  let mergedVersion: number | null = null

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
  if (sug.authorId !== actorUserId) {
    await notify({ recipientId: sug.authorId, actorId: actorUserId, type: 'suggestion_accepted', templateId: tpl.id, suggestionId: sug.id })
  }
  // git-merge создаёт версию МИМО listStore.addVersion → фасадный барьер её не ловит.
  if (tpl.visibility === 'public') await recheckList(tpl.id)
  await notifyWatchersNewVersion(tpl.id, actorUserId)
  await enqueueReindex(tpl.id)
  return { ok: true, owner, slug: tpl.slug, kind: 'branch' }
}


/**
 * ЯДРО принятия правки — БЕЗ 'use server'.
 *
 * Модуль отдельный не для порядка, а по необходимости: любой экспорт из файла с
 * 'use server' — это сетевая точка входа, которую клиент зовёт с ЛЮБЫМИ аргументами.
 * У этой функции личность действующего лица приходит аргументом (`actorUserId`), и в
 * экшен-файле она означала бы «примите правку от имени владельца, чей id я подставил»:
 * гейт `ownerId !== actorUserId` сверялся бы с числом, которое прислал нападающий.
 *
 * Здесь функция обычная: её зовут сервером — экшен со своей сессией и MCP с userId
 * токена. Ни один из них не берёт личность из запроса.
 */
export async function applySuggestion(
  suggestionId: string,
  actorUserId: string,
): Promise<{ ok: true; templateId: string; slug: string; version: number } | { ok: false; reason: string }> {
  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
  if (!sug) return { ok: false, reason: 'not found' }
  if (sug.status !== 'open') return { ok: false, reason: `already ${sug.status}` }
  if (sug.template.ownerId !== actorUserId) return { ok: false, reason: 'not your list' }
  if (sug.draft) return { ok: false, reason: 'draft' } // черновик не принимаем — см. mergeBranchPr
  // Запрошенные правки блокируют принятие — иначе вердикт «просит доработать»
  // был бы декоративным. Разблокировать может сам рецензент, сменив свой голос.
  if (await hasBlockingReview(sug.id)) return { ok: false, reason: 'a reviewer requested changes' }
  // Остальные гейты — по настройкам списка (раздел «Предложения»). Проверяем ЗДЕСЬ,
  // а не в экшене: через MCP правку принимают тем же ядром, и гейты не должны
  // зависеть от того, пришёл человек со страницы или агент.
  const prs = withPrDefaults(sug.template.prSettings)
  if (prs.blockOnUnresolved && (await countUnresolvedThreads(sug.id))) return { ok: false, reason: 'unresolved discussions' }
  const checksBlock = await checksGate(sug.id, prs.blockOnFailedChecks, await currentRevision(sug))
  if (checksBlock) return { ok: false, reason: checksBlock }
  if (prs.requiredApprovals > 0 && (await countApprovals(sug.id)) < prs.requiredApprovals)
    return { ok: false, reason: `needs ${prs.requiredApprovals} approval(s)` }

  const tpl = sug.template
  // Новая версия из принятого предложения — через доменный порт.
  const ver = await listStore.addVersion(tpl.id, { note: sug.note || 'suggested edit', steps: toStepInput(sug.items), authorId: actorUserId })
  // Пере-проверку делает фасад listStore.addVersion (барьер) — здесь не дублируем.
  await db
    .update(suggestions)
    .set({ status: 'accepted', resolvedAt: new Date() })
    .where(eq(suggestions.id, sug.id))
  // «closes #12» в заметке закрывает задачи — но только теперь, когда изменения приняты.
  await closeLinkedIssues(tpl.id, sug.note, actorUserId, prs.autoCloseIssues)
  await notify({ recipientId: sug.authorId, actorId: actorUserId, type: 'suggestion_accepted', templateId: tpl.id, suggestionId: sug.id })
  await notifyWatchersNewVersion(tpl.id, actorUserId)
  await enqueueReindex(tpl.id)
  return { ok: true, templateId: tpl.id, slug: tpl.slug, version: ver.version }
}

/**
 * ЯДРО СОЗДАНИЯ предложения — без сессии и без редиректа.
 *
 * Те же ворота, что у формы: нельзя предлагать к списку, которого не видишь
 * (иначе это запись в чужую очередь плюс оракул существования), нельзя к архиву и
 * заморозке, и настройка «кто может предлагать» действует одинаково для человека и
 * для агента. Кап на автора тоже общий: правка пингует владельца, и агенту эта
 * дверь открыта ровно настолько же.
 */
export async function createSuggestion(
  actorUserId: string,
  templateId: string,
  input: { note: string; items: unknown[] },
): Promise<{ ok: true; id: string; number: number | null } | { ok: false; reason: string }> {
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return { ok: false, reason: 'list not found' }
  const isOwner = tpl.ownerId === actorUserId
  if (!canViewList(tpl, { isOwner, isCollaborator: !isOwner && (await isCollaborator(tpl.id, actorUserId)) })) {
    return { ok: false, reason: 'list not found' } // не подтверждаем существование скрытого
  }
  if (!canEditList(tpl)) return { ok: false, reason: tpl.archivedAt ? 'list is archived' : 'list is frozen' }

  const prs = withPrDefaults(tpl.prSettings)
  if (prs.allowFrom === 'collaborators' && !isOwner && !(await isCollaborator(tpl.id, actorUserId))) {
    return { ok: false, reason: 'this list accepts suggestions from collaborators only' }
  }
  if (!(await rateLimit(`suggest:${actorUserId}`, 10, 10 * 60_000)).ok) return { ok: false, reason: 'rate limited' }

  const note = input.note.trim().slice(0, 2000)
  const created = await collabStore.createSuggestion(tpl.id, actorUserId, note, toStepInput(input.items as never))
  await curationStore.ensureWatch(tpl.id, actorUserId) // автор правки следит за списком
  await notify({ recipientId: tpl.ownerId, actorId: actorUserId, type: 'suggestion_new', templateId: tpl.id, suggestionId: created.id })

  const [row] = await db.select({ number: suggestions.number }).from(suggestions).where(eq(suggestions.id, created.id)).limit(1)
  return { ok: true, id: created.id, number: row?.number ?? null }
}

/**
 * ЯДРО РЕВЬЮ — без сессии.
 *
 * Вердикт один на рецензента и ПЕРЕЗАПИСЫВАЕТСЯ: иначе «одобрил → передумал»
 * оставляло бы оба состояния сразу, и текущее определить нечем. Новый вердикт
 * снимает прежний dismiss — переголосовавший после снятия иначе оставался бы
 * снятым, то есть его голос молча не считался бы.
 *
 * Автор правки своё же ревью не оставляет — как в GitHub.
 */
export async function reviewSuggestion(
  actorUserId: string,
  suggestionId: string,
  verdict: string,
  body: string,
): Promise<{ ok: true; verdict: string } | { ok: false; reason: string }> {
  if (!isVerdict(verdict)) return { ok: false, reason: 'verdict must be approve, changes or comment' }
  const text = body.trim().slice(0, 10_000)

  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
  if (!sug) return { ok: false, reason: 'not found' }
  if (sug.status !== 'open') return { ok: false, reason: `already ${sug.status}` } // закрытую правку не ревьюят
  if (sug.authorId === actorUserId) return { ok: false, reason: 'you cannot review your own suggestion' }
  // Ревьюит тот, кто список ВИДИТ: приватный чужому не показываем и вердикта в нём не принимаем.
  const isOwner = sug.template.ownerId === actorUserId
  if (!canViewList(sug.template, { isOwner, isCollaborator: !isOwner && (await isCollaborator(sug.templateId, actorUserId)) })) {
    return { ok: false, reason: 'not found' }
  }

  await db
    .insert(suggestionReviews)
    .values({ suggestionId, reviewerId: actorUserId, verdict, body: text })
    .onConflictDoUpdate({
      target: [suggestionReviews.suggestionId, suggestionReviews.reviewerId],
      set: { verdict, body: text, updatedAt: new Date(), dismissedAt: null, dismissedById: null, dismissReason: null },
    })

  // Автор правки должен узнать, что по ней высказались.
  await notify({ recipientId: sug.authorId, actorId: actorUserId, type: 'suggestion_comment', templateId: sug.templateId, suggestionId })
  return { ok: true, verdict }
}

/**
 * ОТКАТ принятого предложения — как Revert у GitHub.
 *
 * Откат НЕ правит историю тихо: он создаёт новое предложение, которое отменяет
 * старое и проходит те же ворота — ревью, гейты, слияние. Мгновенная отмена в обход
 * ревью была бы дырой ровно того размера, что и слияние без ревью.
 *
 * Отменяем ВКЛАД, а не «возвращаем список к старой версии»: между слиянием и
 * откатом список живёт своей жизнью, и откат к снимку затёр бы чужую работу. Что
 * именно внесла правка, считает `revertPlan` по идентичности блоков.
 *
 * Пункты, которые с тех пор трогали, возвращаются СПИСКОМ, а не разрешаются
 * догадкой: отменить их автоматически нельзя, и человек должен увидеть, какие
 * именно.
 */
export async function revertSuggestion(
  actorUserId: string,
  suggestionId: string,
): Promise<{ ok: true; id: string; number: number | null } | { ok: false; reason: string; conflicts?: { title: string }[] }> {
  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
  if (!sug) return { ok: false, reason: 'not found' }
  if (sug.status !== 'accepted') return { ok: false, reason: 'only an accepted suggestion can be reverted' }
  const tpl = sug.template
  if (tpl.ownerId !== actorUserId && !(await isCollaborator(tpl.id, actorUserId))) return { ok: false, reason: 'not a maintainer' }
  // Правки, принятые до появления этого поля, откату не поддаются: что именно они
  // внесли, пришлось бы угадывать по времени и тексту заметки.
  if (!sug.mergedVersion) return { ok: false, reason: 'accepted before revert existed — revert it by hand' }

  // Уже отменено — второй откат отменял бы отмену.
  const dup = await db.query.suggestions.findFirst({
    where: (s) => and(eq(s.revertOfId, sug.id), eq(s.status, 'open')),
  })
  if (dup) return { ok: false, reason: `already being reverted in #${dup.number ?? dup.id}` }

  const [before, after, current] = await Promise.all([
    getVersionSteps(tpl.id, sug.mergedVersion - 1),
    getVersionSteps(tpl.id, sug.mergedVersion),
    getVersionSteps(tpl.id, tpl.currentVersion),
  ])
  if (!after || !current) return { ok: false, reason: 'versions are gone' }

  const plan = revertPlan(
    (before?.steps ?? []) as unknown as ProposedItem[],
    after.steps as unknown as ProposedItem[],
    current.steps as unknown as ProposedItem[],
  )
  if (plan.conflicts.length > 0) {
    return {
      ok: false,
      reason: 'these items changed after the merge — revert cannot undo them safely',
      conflicts: plan.conflicts.map((c) => ({ title: c.title })),
    }
  }

  const head = sug.note.split(/\r?\n/)[0].trim().slice(0, 100)
  const created = await createSuggestion(actorUserId, tpl.id, {
    note: `Revert «${head || `#${sug.number ?? ''}`}»${sug.number ? ` (#${sug.number})` : ''}`,
    items: plan.items,
  })
  if (!created.ok) return created
  await db.update(suggestions).set({ revertOfId: sug.id }).where(eq(suggestions.id, created.id))
  return created
}

/**
 * Текущая ревизия предложения — то, что сейчас предлагается слить.
 *
 * У предложения из ветки это её tip (новый коммит меняет ревизию), у предложения из
 * пунктов — отпечаток самих пунктов. Ветка недоступна (репозитория нет, ветку
 * удалили) → null: тогда сверять не с чем, и устаревшими проверки не объявляем —
 * иначе недоступность git превращалась бы в блокировку слияния.
 */
export async function currentRevision(sug: { id: string; branchRef: string | null; items: unknown; templateId: string }): Promise<string | null> {
  if (!sug.branchRef) return itemsRevision((sug.items ?? []) as ProposedItem[])
  const [tpl] = await db.select({ slug: templates.slug, ownerId: templates.ownerId }).from(templates).where(eq(templates.id, sug.templateId)).limit(1)
  if (!tpl) return null
  const [owner] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, tpl.ownerId)).limit(1)
  const { gitCore } = await gitPort()
  const snap = await gitCore.branchSnapshot({ owner: owner?.handle ?? '', slug: tpl.slug }, sug.branchRef).catch(() => null)
  return snap?.tipSha ? branchRevision(snap.tipSha) : null
}
