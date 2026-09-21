import 'server-only'
import type { BranchSnapshot } from '@/core'
import type { ProposedItem } from '@/shared/db'
// eslint-disable-next-line boundaries/dependencies -- снапшот ветки берётся у git-порта
import { gitCore } from '@/features/git/core'
// eslint-disable-next-line boundaries/dependencies -- один маппинг снапшота на приложение
import { snapshotSteps } from '@/features/git/snapshot-steps'

/**
 * Предлагаемые блоки предложения — ОДИН источник для страницы и для экшенов.
 *
 * У branch-PR предлагаемые пункты живут в tip ветки, а `suggestions.items` пусты;
 * у старых предложений — наоборот. Пока это знание было только в странице, экшен
 * создания комментария искал блок в `items` и на branch-PR не находил НИЧЕГО:
 * комментарии к пунктам там молча не создавались.
 */

/** Правило без загрузки: у кого снапшот уже на руках (страница), тот не платит за git второй раз. */
export function blocksFrom(sug: { branchRef: string | null; items: unknown }, snapshot: BranchSnapshot | null): ProposedItem[] {
  if (sug.branchRef) return snapshot ? (snapshotSteps(snapshot) as unknown as ProposedItem[]) : []
  return (sug.items ?? []) as ProposedItem[]
}

/** Код отказа чтения — он же уходит человеку в `?e=` (словарь `merge-err.ts`). */
export const BLOCKS_UNREADABLE = 'snapshot-unavailable'

/** Исход загрузки: пункты ЛИБО причина, по которой их не прочитали. */
export type SuggestionBlocksRead = { ok: true; blocks: ProposedItem[] } | { ok: false; reason: typeof BLOCKS_UNREADABLE }

/**
 * То же правило, но со своей загрузкой снапшота — для экшенов, где его нет.
 *
 * ⚠️ ВОЗВРАЩАЕТ ИСХОД, А НЕ МАССИВ, и это не украшательство. Прежняя редакция гасила
 * сбой чтения (`.catch(() => null)`) и отдавала пустой массив: вызывающий не мог
 * отличить «в ветке нет пунктов» от «до ядра не достучались». На пути слияния это
 * открывало стража исполняемых команд — пусто значило «команд нет», то есть РАЗРЕШЕНИЕ
 * ровно тогда, когда проверить было нечем. Тип заставляет назвать решение в каждой
 * точке; молча получить пустоту вместо отказа больше нельзя.
 */
export async function readSuggestionBlocks(
  sug: { branchRef: string | null; items: unknown },
  owner: string,
  slug: string,
): Promise<SuggestionBlocksRead> {
  if (!sug.branchRef) return { ok: true, blocks: blocksFrom(sug, null) }
  let snapshot: BranchSnapshot | null
  // Под catch — РОВНО чтение, и ни строкой больше. Обернуть заодно и разбор значило бы
  // выдавать ошибку в нашем маппинге за недоступность ядра: чинили бы сеть вместо кода.
  try {
    // null здесь — честный ответ ядра «ветки/list.json нет» (см. порт): пунктов в ней
    // действительно нет. Отказ связи приходит исключением.
    snapshot = await gitCore.branchSnapshot({ owner, slug }, sug.branchRef)
  } catch {
    return { ok: false, reason: BLOCKS_UNREADABLE }
  }
  return { ok: true, blocks: blocksFrom(sug, snapshot) }
}
