// Замок списка и правила записи черновика. Причина измениться у модуля одна — как
// параллельные правки одного списка выстраиваются в очередь.
//
// Здесь ЖИЛА прямая перезапись шагов версии (`replaceDraftStepsIn`) с пометкой
// TODO(rust-boundary) — она шла мимо фасада listStore, то есть мимо ядра, которое одно
// создаёт коммит. 19.08 линза ядра 02 измерила цену: git о такой правке не узнавал
// никогда. Путь удалён вместе с механикой «черновик правится на месте» (ADR-0020);
// возвращать его нельзя — гейт `tests/features/mcp/git-parity.itest.ts` это ловит.

import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, runs, runStepState, steps, templates, type ProposedItem } from '@/shared/db'
import { canEditList } from '@/core'
import { assertNoDestructiveSteps } from '@/core/domain/destructive-command'
// Единый конвертер шагов на запись — тот же, что у веба, садовника и предложений.
// Своя копия в MCP теряла blockId и «здесь нужен человек» (см. комментарий в модуле).
import { toStepInput as stepInput } from '@/shared/lib/step-input'

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

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
