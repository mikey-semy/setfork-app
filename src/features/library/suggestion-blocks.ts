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

/** То же правило, но со своей загрузкой снапшота — для экшенов, где его нет. */
export async function suggestionBlocks(
  sug: { branchRef: string | null; items: unknown },
  owner: string,
  slug: string,
): Promise<ProposedItem[]> {
  const snapshot = sug.branchRef ? await gitCore.branchSnapshot({ owner, slug }, sug.branchRef).catch(() => null) : null
  return blocksFrom(sug, snapshot)
}
