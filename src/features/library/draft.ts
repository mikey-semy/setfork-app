import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { db, listDrafts, templates, type ProposedItem } from '@/shared/db'
import { ListWriteError } from '@/core/ports'
import { listStore } from './list-store'
import { toStepInput } from '@/shared/lib/step-input'
import { getDraft } from './queries'

// ОДИН путь для черновика правок на оба входа — редактор и API. Второй вход
// (MCP) появился сразу после первого, и написать ему свою запись значило бы
// завести третью копию логики версий: в этом проекте такие копии уже расходились
// (конвертер шагов жил в трёх местах и терял bid). Здесь — только домен, без
// сессий и редиректов: их добавляет вызывающий.

export interface DraftMeta {
  tags?: string[]
  ordered?: boolean
  gated?: boolean
}

type ListRow = { id: string; currentVersion: number; tags: string[]; ordered: boolean; gated: boolean }

/**
 * Записать (или обновить) черновик правок автора.
 *
 * base_version у СУЩЕСТВУЮЩЕГО черновика не трогаем: он говорит, от какой версии
 * сделаны правки. Сдвинуть его — значит соврать, что правки свежие, и позволить
 * следующей публикации затереть чужую работу.
 */
export async function upsertDraft(
  tpl: ListRow,
  authorId: string,
  data: { items: ProposedItem[]; meta: DraftMeta; note: string },
): Promise<void> {
  await db
    .insert(listDrafts)
    .values({ templateId: tpl.id, authorId, baseVersion: tpl.currentVersion, items: data.items, meta: data.meta, note: data.note })
    .onConflictDoUpdate({
      target: [listDrafts.templateId, listDrafts.authorId],
      set: { items: data.items, meta: data.meta, note: data.note, rev: sql`${listDrafts.rev} + 1`, updatedAt: new Date() },
    })
}

/** Убрать черновик автора (публикация его исчерпала либо от правок отказались). */
export async function deleteDraft(templateId: string, authorId: string): Promise<void> {
  await db.delete(listDrafts).where(and(eq(listDrafts.templateId, templateId), eq(listDrafts.authorId, authorId)))
}

/**
 * Пополнение реестра тегов — портом, а не импортом: `features/library` не может тянуть
 * `features/tags` (границы слоёв). Связывает их composition root, как `registerAfterVersion`
 * и `registerModerationGate`. До регистрации пусто — безопасно: публикация до старта
 * воркера не случается.
 */
type TagsRegistrar = (slugs: string[]) => Promise<void>
let tagsRegistrar: TagsRegistrar | null = null
export function registerTagsRegistrar(fn: TagsRegistrar): void {
  tagsRegistrar = fn
}

export type PublishResult =
  | { version: number; blocks: number }
  | { error: 'no draft' | 'stale' | 'empty'; message: string; currentVersion?: number; baseVersion?: number }

/**
 * Опубликовать черновик автора ОДНОЙ версией. Запись идёт обычным путём
 * (ListStore.addVersion → git-коммит в ядре), поэтому барьеры архива, заморозки и
 * модерации остаются на месте.
 *
 * expectedVersion — настоящая защита от гонки: ядро сверяет её внутри транзакции,
 * где строка списка уже взята for update. Сравнение чисел здесь — только ранний
 * отсев с понятным ответом.
 */
export async function publishDraftFor(tpl: ListRow, authorId: string, note?: string): Promise<PublishResult> {
  const draft = await getDraft(tpl.id, authorId)
  if (!draft) return { error: 'no draft', message: 'there are no unpublished edits to publish' }
  if (draft.items.length === 0) return { error: 'empty', message: 'the draft has no blocks left' }
  if (draft.baseVersion !== tpl.currentVersion) {
    return {
      error: 'stale',
      message: `the list moved to version ${tpl.currentVersion} while your edits were based on ${draft.baseVersion} — read it again (get_list) and redo the edits`,
      currentVersion: tpl.currentVersion,
      baseVersion: draft.baseVersion,
    }
  }

  const tags = draft.meta.tags ?? tpl.tags
  const ordered = draft.meta.ordered ?? tpl.ordered
  // Реестр тегов пополняется ЗДЕСЬ, на единой точке публикации черновика.
  //
  // Раньше это делал вызывающий, и в комментарии рядом стояло объяснение: границы слоёв
  // не дают features/library тянуть features/tags. Объяснение верное, а решение — нет:
  // вызывающих оказалось двое, веб звал, а MCP нет, и тег, заведённый ассистентом, в
  // каталоге и подсказках не появлялся вовсе (находка авто-ревью по #812). Ровно тем же
  // однажды кончился ручной вызов пере-проверки модерации на каждом пути записи.
  //
  // Границу слоёв держим инверсией, как уже сделано для модерации и индекса: порт
  // регистрирует composition root (instrumentation), фича его не импортирует.
  if (draft.meta.tags?.length) await tagsRegistrar?.(draft.meta.tags)
  let created: { version: number }
  try {
    created = await listStore.addVersion(tpl.id, {
      note: (note ?? draft.note).trim() || 'edit',
      steps: toStepInput(draft.items),
      authorId,
      meta: { tags, ordered },
      expectedVersion: draft.baseVersion,
    })
  } catch (e) {
    if (e instanceof ListWriteError && e.code === 'stale') {
      return { error: 'stale', message: 'the list changed while publishing — read it again (get_list) and redo the edits' }
    }
    throw e
  }
  // gated — не канон (надстройка Postgres), поэтому пишется ПОСЛЕ успешной версии:
  // при отказе ядра мета не должна уезжать вперёд содержимого.
  await db.update(templates).set({ gated: draft.meta.gated ?? tpl.gated, updatedAt: new Date() }).where(eq(templates.id, tpl.id))
  // Удаляем ИМЕННО опубликованную ревизию: пока шёл вызов ядра, соседний вход мог
  // сохранить новые правки, и безусловное удаление стёрло бы их.
  await db
    .delete(listDrafts)
    .where(and(eq(listDrafts.templateId, tpl.id), eq(listDrafts.authorId, authorId), eq(listDrafts.rev, draft.rev)))
  // Поиск обязан увидеть новую версию: без переиндексации он отдавал бы прошлую,
  // пока список не сохранят ещё раз. Оба входа (редактор и API) идут здесь.
  const { enqueueReindex } = await import('./jobs')
  await enqueueReindex(tpl.id)
  // Номер версии берём У ЯДРА, а не считаем: считать значит верить, что проекция
  // и нумерация никогда не расходятся.
  return { version: created.version, blocks: draft.items.length }
}
