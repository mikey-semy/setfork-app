// Общая половина записи: найти свой список, положить новый состав блоков.
// Причина измениться одна — как список попадает на запись (владение, прежние
// адреса, черновик против опубликованного, отказ ядра по устаревшей версии).
//
// Путь один намеренно: update_list и patch_list приходят сюда оба. Писать список
// двумя разными путями значит рано или поздно расхождение между ними.

import 'server-only'
import { eq } from 'drizzle-orm'
import { db, templates, type ProposedItem } from '@/shared/db'
import { canEditList, ListWriteError } from '@/core'
import { DestructiveCommandError } from '@/core/domain/destructive-command'
import { listStore } from '@/features/library/list-store'
// Единый конвертер шагов на запись — тот же, что у веба, садовника и предложений.
// Своя копия в MCP теряла blockId и «здесь нужен человек» (см. комментарий в модуле).
import { toStepInput as stepInput } from '@/shared/lib/step-input'
import { resolveListRefOrMoved } from '../shared'
import { draftWritable, duplicateBid, lockList, replaceDraftStepsIn } from './draft-store'

/** Отказ стража разрушительных команд → ответ инструмента. Это не сбой, а
 *  вердикт: агенту нужно назвать причину, а не увидеть стектрейс. */
export const destructiveError = (e: unknown): { error: string } | null =>
  e instanceof DestructiveCommandError
    ? { error: `refused: step ${e.stepIndex} has a destructive command (${e.reason}): ${e.fragment}` }
    : null

/** Список во владении пользователя (для записи) + его версии.
 *
 *  Адрес резолвится с учётом ПРЕЖНИХ: у агента ссылка могла остаться со времён до
 *  переименования, и запрещать по ней запись незачем — ведёт она на тот же список.
 *  Так же поступает GitHub API: запросы по прежнему имени репозитория доезжают
 *  через 301, а не отклоняются. */
export async function ownedList(userId: string, handle: string, slug: string) {
  const found = await resolveListRefOrMoved(`${handle}/${slug}`)
  if (!found) return { error: 'list not found' as const }
  const tpl = await db.query.templates.findFirst({
    where: (t) => eq(t.id, found.id),
    with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
  })
  if (!tpl) return { error: 'list not found' as const }
  if (tpl.ownerId !== userId) return { error: 'forbidden: you are not the owner' as const }
  // Архив/заморозка: гейт нужен ЗДЕСЬ, а не только в фасадном бэкстопе addVersion —
  // мета (tags/ordered) обновляется до версии и не должна утечь в read-only список.
  if (!canEditList(tpl)) return { error: 'forbidden: list is archived or frozen' as const }
  return { tpl }
}

/** Записать НОВЫЙ состав блоков (доменная форма): черновик правится на месте,
 *  опубликованный получает новую версию. Общая половина update_list и patch_list —
 *  писать список двумя разными путями значит рано или поздно расхождение. */
export async function writeProposed(
  tpl: NonNullable<Awaited<ReturnType<typeof ownedList>>['tpl']>,
  handle: string,
  slug: string,
  proposed: ProposedItem[],
  note: string,
  meta: { tags: string[]; ordered: boolean },
  expectedVersion?: number,
) {
  if (!proposed.length) return { error: 'at least one item with a title is required' }
  const dup = duplicateBid(proposed)
  if (dup) return { error: `two blocks share the same bid "${dup}" — a block id must be unique within a list` }

  if (tpl.status === 'draft') {
    // черновик — перезаписываем текущую версию на месте (без плодения версий).
    // ПОД ТЕМ ЖЕ замком, что и патч: иначе полная замена и патч переплетаются —
    // замена удаляет и вставляет строки, пока патч держит только замок списка, и
    // чья-то работа пропадает при обоих «успешных» ответах.
    const cur = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[0]
    try {
      const gate = await db.transaction(async (tx) => {
        await lockList(tx, tpl.id)
        const denied = await draftWritable(tx, tpl.id)
        if (denied) return denied
        await replaceDraftStepsIn(tx, cur.id, proposed)
        await tx.update(templates).set({ tags: meta.tags, ordered: meta.ordered, updatedAt: new Date() }).where(eq(templates.id, tpl.id))
        return null
      })
      if (gate) return gate
    } catch (e) {
      const refused = destructiveError(e)
      if (refused) return refused
      throw e
    }
    return { ref: `${handle}/${slug}`, status: 'draft', version: cur.version }
  }

  // tags/ordered едут ВНУТРИ addVersion (Ф2a-довесок): ядро применяет мету той же
  // транзакцией, что и версию, — канон коммита сразу несёт свежие значения.
  // expectedVersion (если задан) ядро сверяет ТАМ ЖЕ: сравнение и запись под одним
  // замком строки, иначе между ними успевает лечь чужая версия.
  let ver
  try {
    ver = await listStore.addVersion(tpl.id, { note, steps: stepInput(proposed), meta, expectedVersion })
  } catch (e) {
    // Отказ ядра по устаревшей версии — не сбой, а нормальный исход гонки: пока
    // правку готовили, список ушёл вперёд. Агент перечитывает и накладывает заново.
    if (e instanceof ListWriteError && e.code === 'stale')
      return { error: 'list changed while the patch was being applied — read it again (get_list) and rebuild the ops' }
    throw e
  }
  // Пере-проверку публичного списка делает фасад listStore.addVersion (барьер): нарушающий
  // контент, залитый через MCP, не минует модерацию, и здесь её дублировать не нужно.
  const { enqueueReindex } = await import('@/features/library/jobs')
  await enqueueReindex(tpl.id)
  return { ref: `${handle}/${slug}`, status: 'published', version: ver.version }
}
