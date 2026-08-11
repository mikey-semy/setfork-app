// Что происходит, когда садовник записал новую версию списка.
//
// Три шага всегда идут вместе — версия, уведомление наблюдателей, переиндексация, —
// и до 11.08 эта тройка была скопирована в трёх местах: рост живого списка, прямая
// правка своего списка, авто-мёрдж на кураторском. Порядок в копиях уже расходился,
// а забыть один шаг в четвёртой копии стоило бы тихой поломки: список правится, но в
// поиске остаётся прежним, а подписавшийся ничего не узнаёт.
//
// Причина измениться у модуля одна: меняется набор последствий записи.

import 'server-only'
import { listStore } from '@/features/library/list-store'
import { notifyMany } from '@/features/notifications/notify'
import { getWatcherIds } from '@/features/watch/queries'
import { enqueueReindex } from '@/features/library/jobs'
import { toStepInput } from '@/shared/lib/step-input'
import type { ProposedItem } from '@/shared/db'

/**
 * Записать версию от имени садовника и довести последствия до конца.
 *
 * `note` приходит снаружи: он описывает ПРИЧИНУ правки (полировка, рост ленты,
 * авто-мёрдж), а её знает вызывающий, не этот модуль.
 */
export async function publishGardenerVersion(
  templateId: string,
  items: ProposedItem[],
  opts: { note: string; authorId: string },
): Promise<void> {
  await listStore.addVersion(templateId, { note: opts.note, steps: toStepInput(items), authorId: opts.authorId })
  await notifyMany(await getWatcherIds(templateId, 'versions'), { actorId: opts.authorId, type: 'new_version', templateId })
  await enqueueReindex(templateId)
}
