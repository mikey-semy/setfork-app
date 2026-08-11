import 'server-only'
import { and, asc, eq, sql } from 'drizzle-orm'
import { assertNoDestructiveSteps } from '@/core/domain/destructive-command'
import { db, listDrafts, steps, templates, templateVersions, type ProposedItem } from '@/shared/db'
import { applyPatchOps, type McpPatchOp } from '../../patch'
import { deleteDraft, publishDraftFor } from '@/features/library/draft'
import { getDraft } from '@/features/library/queries'
// Единый конвертер шагов на запись — тот же, что у веба, садовника и предложений.
// Своя копия в MCP теряла blockId и «здесь нужен человек» (см. комментарий в модуле).
import { toStepInput as stepInput } from '@/shared/lib/step-input'
import { detailByRefOrMoved, toProposed, type DetailStep, type McpItemInput } from '../shared'
import { patchBlock, rowsToProposed } from './patch-block'
import { draftWritable, duplicateBid, lockList, replaceDraftStepsIn } from './draft-store'
import { destructiveError, ownedList, writeProposed } from './write'

/** Обновить список (только владелец). Черновик — правим на месте; опубликованный — новая версия. */
export interface McpUpdateInput {
  items: McpItemInput[]
  note?: string
  tags?: string[]
  ordered?: boolean
}

export async function mcpUpdateList(userId: string, handle: string, slug: string, input: McpUpdateInput) {
  const found = await ownedList(userId, handle, slug)
  if ('error' in found) return found
  const { tpl } = found
  const tags = input.tags
    ? input.tags.map((t) => t.toLowerCase().replace(/[^a-z0-9а-яё-]/gi, '')).filter(Boolean).slice(0, 8)
    : tpl.tags
  return writeProposed(tpl, handle, slug, toProposed(input.items ?? []), input.note?.trim() || 'updated via API', {
    tags,
    ordered: input.ordered ?? tpl.ordered,
  })
}

/**
 * Точечная правка: операции над блоками по стабильному bid вместо перезаписи
 * всего списка. Агент шлёт только дельту, состав блоков сервер берёт сам —
 * поэтому непатченные блоки не могут пострадать от неполного тела запроса.
 *
 * baseVersion обязателен (решение владельца; так же устроены sha в GitHub
 * contents API и requiredRevisionId в Google Docs): правка применяется только к
 * той версии, которую агент читал. Иначе он затирал бы правку, сделанную в вебе
 * секундой раньше, даже не заметив её.
 *
 * Потерянных обновлений нет ни на одном из двух путей записи, но защищают их
 * РАЗНЫЕ механизмы: у опубликованного — expected_version в ядре, у черновика (где
 * номер версии не растёт и сверять нечем) — замок строки списка, под которым идут
 * и чтение блоков, и их замена.
 */
export async function mcpPatchList(
  userId: string,
  handle: string,
  slug: string,
  input: { baseVersion: number; ops: McpPatchOp[]; note?: string; publish?: boolean },
) {
  const found = await ownedList(userId, handle, slug)
  if ('error' in found) return found
  const { tpl } = found
  const ops = input.ops ?? []

  // Нетронутые блоки идут в запись СВОЕЙ, доменной формой: со всеми переводами и
  // содержимым как есть. Через плоскую MCP-форму проходит только патчимый блок —
  // иначе правка одного заголовка стирала бы переводы и товары у всего списка.
  // Список, который НИКОГДА не публиковался, правится на месте и версий не плодит —
  // копить ему нечего, а молча проигнорировать publish:false нельзя: агент решил бы,
  // что правки лежат в черновике, тогда как они уже в живом списке.
  if (tpl.status === 'draft' && input.publish === false) {
    return {
      error:
        'this list was never published: edits apply in place and do not create versions, so publish:false does not apply here — call patch_list without it',
    }
  }

  const patchIO = {
    bidOf: (it: ProposedItem) =>
      it.blockId ?? (typeof (it.content as Record<string, unknown> | undefined)?.bid === 'string' ? (it.content as Record<string, string>).bid : undefined),
    update: patchBlock,
    create: (block: McpItemInput) => toProposed([block])[0] ?? { error: 'the inserted block is empty (a step needs a title)' },
  }

  if (tpl.status === 'draft') {
    // ЧЕРНОВИК: читаем состав и заменяем его ПОД ОДНИМ замком. Конкурирующий патч
    // ждёт на нём и потом читает уже новое состояние — вместо того чтобы наложить
    // свои операции на снимок, который к моменту записи устарел.
    try {
      return await db.transaction(async (tx) => {
      await lockList(tx, tpl.id)
      // Состояние ПЕРЕЧИТЫВАЕМ под замком: пока патч готовили, список могли
      // опубликовать, заморозить или заархивировать. Со старыми данными на руках
      // правка заменила бы шаги уже опубликованной версии НА МЕСТЕ — без новой
      // версии и без git-коммита, то есть мимо истории.
      const denied = await draftWritable(tx, tpl.id)
      if (denied) return denied
      const [fresh] = await tx.select({ current: templates.currentVersion }).from(templates).where(eq(templates.id, tpl.id))
      if (!fresh) return { error: 'list not found' }
      if (input.baseVersion !== fresh.current)
        return { error: `list changed: it is at version ${fresh.current}, your patch is based on ${input.baseVersion} — read it again (get_list) and rebuild the ops` }
      const [cur] = await tx
        .select({ id: templateVersions.id, version: templateVersions.version })
        .from(templateVersions)
        .where(and(eq(templateVersions.templateId, tpl.id), eq(templateVersions.version, fresh.current)))
        .limit(1)
      if (!cur) return { error: 'list not found' }

      const rows = await tx.select().from(steps).where(eq(steps.versionId, cur.id)).orderBy(asc(steps.n))
      const applied = applyPatchOps<ProposedItem>(rowsToProposed(rows as unknown as DetailStep[]), ops, patchIO)
      if ('error' in applied) return applied
      if (!applied.items.length) return { error: 'at least one item with a title is required' }
      const dupBid = duplicateBid(applied.items)
      if (dupBid) return { error: `two blocks share the same bid "${dupBid}" — a block id must be unique within a list` }
      await replaceDraftStepsIn(tx, cur.id, applied.items)
        await tx.update(templates).set({ updatedAt: new Date() }).where(eq(templates.id, tpl.id))
        return { ref: `${handle}/${slug}`, status: 'draft', version: cur.version, ops: ops.length, blocks: applied.items.length }
      })
    } catch (e) {
      const refused = destructiveError(e)
      if (refused) return refused
      throw e
    }
  }

  const detail = await detailByRefOrMoved(handle, slug)
  if (!detail) return { error: 'list not found' }
  const current = detail.currentVersion?.version ?? tpl.currentVersion

  // publish:false — правки НЕ создают версию, а копятся в черновике (том же, что
  // видит редактор). Патч ложится ПОВЕРХ черновика, если он есть: иначе второй
  // вызов затирал бы первый, и «накопить пачку» было бы невозможно. База сверяется
  // с версией, от которой черновик начат, — она и уедет в expectedVersion при
  // публикации.
  if (input.publish === false) {
    // Чтение и запись черновика — ПОД ОДНИМ замком списка. Иначе два патча (или патч
    // и сохранение человеком в редакторе) читают один и тот же состав, а пишут по
    // очереди целиком — и правка первого исчезает, хотя оба получили «успех».
    try {
      return await db.transaction(async (tx) => {
        await lockList(tx, tpl.id)
        const [fresh] = await tx.select({ current: templates.currentVersion }).from(templates).where(eq(templates.id, tpl.id))
        if (!fresh) return { error: 'list not found' }
        const [existing] = await tx
          .select()
          .from(listDrafts)
          .where(and(eq(listDrafts.templateId, tpl.id), eq(listDrafts.authorId, userId)))
          .limit(1)
        // База — та, от которой сделаны НАКОПЛЕННЫЕ правки: патч ложится поверх них.
        const base = existing?.baseVersion ?? fresh.current
        if (input.baseVersion !== base)
          return {
            error: `your patch is based on version ${input.baseVersion}, but the pending edits are based on ${base} — pass baseVersion ${base} (see pendingEdits in get_list), or drop them with discard_draft`,
          }
        const source = existing ? existing.items : rowsToProposed(detail.steps)
        const appliedDraft = applyPatchOps<ProposedItem>(source, ops, patchIO)
        if ('error' in appliedDraft) return appliedDraft
        if (!appliedDraft.items.length) return { error: 'at least one item with a title is required' }
        const dup = duplicateBid(appliedDraft.items)
        if (dup) return { error: `two blocks share the same bid "${dup}" — a block id must be unique within a list` }
        // Страж исполняемого выхода стоит на КАЖДОЙ записи, включая черновик: иначе
        // через API можно положить `rm -rf /` в чужую рабочую копию, и отказ прилетел
        // бы человеку при публикации, на непонятном ему шаге.
        assertNoDestructiveSteps(stepInput(appliedDraft.items))
        await tx
          .insert(listDrafts)
          .values({
            templateId: tpl.id,
            authorId: userId,
            baseVersion: base,
            items: appliedDraft.items,
            // Мету НЕ снимаем: теги, порядок и «курс» меняются без версии, и снимок
            // откатил бы их при публикации к состоянию на момент первого патча.
            meta: existing?.meta ?? {},
            note: input.note?.trim() || existing?.note || '',
          })
          .onConflictDoUpdate({
            target: [listDrafts.templateId, listDrafts.authorId],
            set: { items: appliedDraft.items, note: input.note?.trim() || existing?.note || '', rev: sql`${listDrafts.rev} + 1`, updatedAt: new Date() },
          })
        return {
          ref: `${handle}/${slug}`,
          status: 'pending' as const,
          baseVersion: base,
          ops: ops.length,
          blocks: appliedDraft.items.length,
          hint: `nothing is published yet — call publish_draft to turn these edits into version ${base + 1}, keep patching with publish:false, or drop them with discard_draft`,
        }
      })
    } catch (e) {
      const refused = destructiveError(e)
      if (refused) return refused
      throw e
    }
  }

  if (input.baseVersion !== current)
    return { error: `list changed: it is at version ${current}, your patch is based on ${input.baseVersion} — read it again (get_list) and rebuild the ops` }

  const applied = applyPatchOps<ProposedItem>(rowsToProposed(detail.steps), ops, patchIO)
  if ('error' in applied) return applied

  // Сверка версии выше — ранний отсев: отбить заведомо устаревший патч дешевле, чем
  // собирать состав. Но решает не она: baseVersion уходит в ядро, и настоящая
  // проверка происходит там, внутри транзакции, где строка списка заблокирована.
  const res = await writeProposed(
    tpl,
    handle,
    slug,
    applied.items,
    input.note?.trim() || 'patched via API',
    { tags: tpl.tags, ordered: tpl.ordered },
    input.baseVersion,
  )
  return 'error' in res ? res : { ...res, ops: ops.length, blocks: applied.items.length }
}

/**
 * Опубликовать накопленные правки одной версией (тот же путь, что кнопка в редакторе).
 *
 * ДВУХШАГОВО без confirm: черновик один на человека, и агент делит его с редактором —
 * там могла остаться незаконченная работа. Первый вызов показывает, ЧТО уедет в
 * версию, второй (confirm:true) публикует.
 */
export async function mcpPublishDraft(userId: string, handle: string, slug: string, note?: string, confirm = false) {
  const found = await ownedList(userId, handle, slug)
  if ('error' in found) return found
  const { tpl } = found
  if (tpl.status === 'draft')
    return { error: 'this list was never published: it is edited in place, so there is nothing to publish from a draft — use publish on the list itself' }
  const draft = await getDraft(tpl.id, userId)
  if (!draft) return { error: 'there are no unpublished edits to publish' }
  if (!confirm) {
    return {
      ref: `${handle}/${slug}`,
      published: false,
      baseVersion: draft.baseVersion,
      wouldBeVersion: tpl.currentVersion + 1,
      blocks: draft.items.length,
      note: (note ?? draft.note).trim() || 'edit',
      updatedAt: draft.updatedAt.toISOString(),
      hint: 'nothing published yet — these edits include everything pending on this list (yours and whatever was left in the editor); call again with confirm:true to publish them as one version',
    }
  }
  try {
    const res = await publishDraftFor(tpl, userId, note)
    if ('error' in res) return { error: res.message }
    // Наблюдатели узнают о версии так же, как при сохранении из редактора.
    const { notifyWatchersNewVersion } = await import('@/features/library/suggestion-side-effects')
    await notifyWatchersNewVersion(tpl.id, userId).catch(() => {})
    return { ref: `${handle}/${slug}`, status: 'published' as const, version: res.version, blocks: res.blocks }
  } catch (e) {
    const refused = destructiveError(e)
    if (refused) return refused
    throw e
  }
}

/** Выбросить накопленные правки — выход из тупика, когда черновик устарел. */
export async function mcpDiscardDraft(userId: string, handle: string, slug: string) {
  const found = await ownedList(userId, handle, slug)
  if ('error' in found) return found
  const { tpl } = found
  const draft = await getDraft(tpl.id, userId)
  if (!draft) return { ref: `${handle}/${slug}`, discarded: false, hint: 'there were no pending edits' }
  await deleteDraft(tpl.id, userId)
  return { ref: `${handle}/${slug}`, discarded: true, blocks: draft.items.length, baseVersion: draft.baseVersion }
}
