// Как состав блоков ложится в строки БД: сверка по идентичности, замок списка,
// состояние прогона. Причина измениться у модуля одна — схема шагов и прогонов.
//
// TODO(rust-boundary): вынести в порт (ListStore.replaceDraftSteps) при следующем
// проходе — прямая правка черновика идёт мимо фасада listStore.

import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, runs, runStepState, steps, templates, type ProposedItem } from '@/shared/db'
import { canEditList } from '@/core'
import { assertNoDestructiveSteps } from '@/core/domain/destructive-command'
// Единый конвертер шагов на запись — тот же, что у веба, садовника и предложений.
// Своя копия в MCP теряла blockId и «здесь нужен человек» (см. комментарий в модуле).
import { toStepInput as stepInput } from '@/shared/lib/step-input'

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Прямая перезапись шагов версии (для in-place правки черновика; порт addVersion
 * создаёт НОВУЮ).
 *
 * Удаление и вставка — ОДНОЙ транзакцией: они и раньше шли парой, но по отдельности,
 * и любой сбой вставки (мусорное значение из внешнего вызова, обрыв связи) оставлял
 * черновик БЕЗ шагов — то есть терял работу владельца целиком.
 */
export async function replaceDraftStepsIn(tx: Tx, versionId: string, items: ProposedItem[]): Promise<void> {
  if (!items.length) return
  // Форму строк берём у ОБЩЕГО конвертера (stepInput): своя копия здесь молча
  // теряла blockId и «здесь нужен человек» — а с ними комментарии к пункту,
  // merge по идентичности и приглашение ответить из опыта.
  const rows = stepInput(items)
  // Страж разрушительных команд стоит в фасаде listStore, но ПРЯМАЯ правка
  // черновика идёт мимо него: без этой проверки через API можно было положить
  // `rm -rf /` в черновик, а get_script отдал бы его готовым скриптом.
  assertNoDestructiveSteps(rows)

  const cols = (it: (typeof rows)[number]) => ({
    n: it.n,
    type: it.type,
    content: it.content,
    blockId: it.blockId,
    title: it.title,
    desc: it.desc,
    command: it.command,
    hasImage: !!it.imageRef,
    imageKey: it.imageRef,
    level: it.level,
    why: it.why,
    needsHuman: it.needsHuman,
    needsHumanAsk: it.needsHumanAsk,
    section: it.section,
    subtasks: it.subtasks,
    refs: it.refs,
  })

  // Строки СВЕРЯЕМ по идентичности блока, а не сносим все разом. steps.id —
  // якорь состояния активного прогона (run_step_state.step_id, ON DELETE CASCADE):
  // полная перезапись стирала отметки, заметки и подпункты у идущего прогона, а
  // сам прогон оставался активным — со ссылками на строки, которых больше нет.
  const existing = await tx.select({ id: steps.id, blockId: steps.blockId }).from(steps).where(eq(steps.versionId, versionId))
  const byBlock = new Map(existing.flatMap((r) => (r.blockId ? [[r.blockId, r.id] as const] : [])))
  const kept = new Set<string>()
  const addedStepIds: string[] = []
  // Запросы идут ПОСЛЕДОВАТЕЛЬНО намеренно: это одна транзакция на одном
  // соединении, параллелить её операции нельзя (Promise.all их только перемешает).
  for (const it of rows) {
    const id = it.blockId ? byBlock.get(it.blockId) : undefined
    if (id) {
      await tx.update(steps).set(cols(it)).where(eq(steps.id, id))
      kept.add(id)
    } else {
      const [row] = await tx.insert(steps).values({ versionId, ...cols(it) }).returning({ id: steps.id, type: steps.type })
      if (row.type === 'step') addedStepIds.push(row.id)
    }
  }
  const gone = existing.flatMap((r) => (kept.has(r.id) ? [] : [r.id]))
  if (gone.length) await tx.delete(steps).where(inArray(steps.id, gone))

  // Новый шаг-блок в версии, по которой УЖЕ идёт прогон, обязан получить строку
  // состояния: её заводят разом при старте прогона, и без неё отметка нового шага
  // молча не срабатывает — ни в вебе (toggleStep выходит), ни через API.
  if (addedStepIds.length) {
    const active = await tx.select({ id: runs.id }).from(runs).where(and(eq(runs.versionId, versionId), eq(runs.status, 'active')))
    if (active.length)
      await tx.insert(runStepState).values(active.flatMap((r) => addedStepIds.map((stepId) => ({ runId: r.id, stepId }))))
  }
}

/** Два блока с одним bid: reconcile попадёт в одну строку дважды, и один блок
 *  молча исчезнет. У патча дубли отбивает applyPatchOps, но полная замена идёт
 *  мимо него — проверяем состав перед записью на обоих путях. */
export function duplicateBid(items: ProposedItem[]): string | null {
  const seen = new Set<string>()
  for (const it of items) {
    const id = it.blockId
    if (!id) continue
    if (seen.has(id)) return id
    seen.add(id)
  }
  return null
}

/** Замок на список внутри транзакции. Патч черновика читает блоки и пишет их
 *  под ним: у черновика номер версии не растёт, поэтому сверять «правка основана
 *  на текущей версии» там нечем — второй патч с тем же baseVersion прошёл бы
 *  проверку и затёр первый. С замком конкурент ждёт и читает УЖЕ новое состояние
 *  (для опубликованных ту же роль играет expected_version в ядре). */
export const lockList = (tx: Tx, listId: string) =>
  tx.execute(sql`select id from ${templates} where ${templates.id} = ${listId} for update`)

/** Состояние списка ПОД ЗАМКОМ: пока правку готовили, его могли опубликовать,
 *  заморозить или заархивировать. Прямая правка черновика идёт мимо фасада
 *  listStore, который стережёт эти запреты у опубликованного пути, — значит
 *  проверяем сами и на свежих данных, а не на прочитанных до замка. */
export async function draftWritable(tx: Tx, listId: string): Promise<{ error: string } | null> {
  const [row] = await tx
    .select({ status: templates.status, archivedAt: templates.archivedAt, frozenAt: templates.frozenAt })
    .from(templates)
    .where(eq(templates.id, listId))
  if (!row) return { error: 'list not found' }
  if (!canEditList(row)) return { error: 'forbidden: list is archived or frozen' }
  if (row.status !== 'draft')
    return { error: 'the list was published while the edit was being prepared — read it again (get_list) and write to the published version' }
  return null
}
