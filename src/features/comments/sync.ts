import 'server-only'
import { eq } from 'drizzle-orm'
import { blockCommentThreads, db, templates } from '@/shared/db'
import { getLang } from '@/shared/i18n/server'
// eslint-disable-next-line boundaries/dependencies -- блоки версии из library
import { getVersionSteps } from '@/features/library/queries'
import type { AnchorableBlock, CommentField } from './fields'
import { reanchorThread, type ThreadAnchorState } from './reanchor'
import { getBlockThreads } from './queries'

/**
 * Пересчитать якоря всех тредов списка против ТЕКУЩЕЙ версии — аналог обновления
 * позиций у GitLab при пуше. Пишет только изменившиеся треды (reanchorThread
 * возвращает null, когда менять нечего).
 *
 * НЕ серверный экшен: живёт в обычном server-only модуле намеренно. В файле с
 * 'use server' любая экспортированная функция становится сетевой точкой входа, и
 * эта — без проверки прав — позволяла бы кому угодно перелопачивать якоря чужого
 * списка по одному templateId. Вызывается только изнутри, после создания версии.
 */
export async function syncBlockThreadAnchors(templateId: string): Promise<void> {
  const [tpl] = await db
    .select({ currentVersion: templates.currentVersion })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
  if (!tpl) return
  const [lang, threads] = await Promise.all([getLang(), getBlockThreads(templateId)])
  if (!threads.length) return

  const version = tpl.currentVersion
  const snap = await getVersionSteps(templateId, version)
  if (!snap) return
  const blocks = snap.steps as AnchorableBlock[]

  // Считаем пере-привязку для всех тредов, пишем только изменившиеся — и
  // параллельно: треды независимы, последовательный await по списку упирался
  // бы в задержку сети на каждом.
  const updates = threads
    .map((t) => {
      const state: ThreadAnchorState = {
        blockId: t.blockId,
        field: t.field as CommentField,
        anchorOriginal: t.anchorOriginal,
        anchorCurrent: t.anchorCurrent,
        anchorState: t.anchorState,
        anchorConfidence: t.anchorConfidence,
        anchorChangedAt: t.anchorChangedAt,
      }
      return { id: t.id, up: reanchorThread(state, blocks, version, lang) }
    })
    .filter((x): x is { id: string; up: NonNullable<ReturnType<typeof reanchorThread>> } => x.up !== null)

  await Promise.all(
    updates.map(({ id, up }) =>
      db
        .update(blockCommentThreads)
        .set({
          anchorCurrent: (up.anchorCurrent ?? null) as unknown as Record<string, unknown> | null,
          anchorState: up.anchorState,
          anchorConfidence: up.anchorConfidence,
          anchorChangedAt: up.anchorChangedAt,
          updatedAt: new Date(),
        })
        .where(eq(blockCommentThreads.id, id)),
    ),
  )
}
