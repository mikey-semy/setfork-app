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
/**
 * Какой именно черновик видел автор: СТРОКА и её номер, а не номер сам по себе.
 *
 * `'none'` — «черновика не было вовсе»: это состояние тоже надо уметь назвать, иначе
 * «поля не прислали» и «черновика не было» сливаются, и сверка отключается целиком.
 */
export type DraftRef = { id: string; rev: number } | 'none'

/**
 * Сменился ли черновик под автором.
 *
 * ⚠️ СРАВНИВАЕТСЯ ПАРА «строка + номер», и это не придирка. Номер каждого нового
 * черновика начинается с 1 (`rev` имеет `default(1)`), поэтому голый счётчик опознаёт
 * не объект, а его возраст: черновик опубликовали или отбросили, агент завёл НОВЫЙ —
 * у обоих `rev = 1`, сравнение говорит «ничего не менялось», и свежие правки агента
 * заменяются молча. Классическая ABA: значение вернулось к прежнему, а объект под ним
 * другой (P1 авто-ревью по #945).
 */
export function draftMoved(expected: DraftRef | undefined, before: { id: string; rev: number } | undefined): boolean {
  if (expected === undefined) return false // путь MCP: правит от свежего чтения под тем же замком
  if (before === undefined) return false // строки нет вовсе — затирать нечего
  if (expected === 'none') return true // её не было, когда автор смотрел, — значит появилась при нём
  return before.id !== expected.id || before.rev !== expected.rev
}

export async function upsertDraft(
  tpl: ListRow,
  authorId: string,
  data: { items: ProposedItem[]; meta: DraftMeta; note: string },
  opts: { expected?: DraftRef } = {},
): Promise<{ id: string; rev: number; overwrote: boolean }> {
  // ⚠️ ПОД ЗАМКОМ СПИСКА — тем же, что берут правки через MCP. Черновик у автора один
  // на список, а входов в него два: редактор и агент, действующий ОТ ЕГО ЖЕ ИМЕНИ
  // (`patch_list` с publish:false кладёт правки в эту же строку). Без замка две записи
  // чередовались бы внутри одной операции; замок их выстраивает в очередь.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${templates} where ${templates.id} = ${tpl.id} for update`)
    const [before] = await tx
      .select({ id: listDrafts.id, rev: listDrafts.rev })
      .from(listDrafts)
      .where(and(eq(listDrafts.templateId, tpl.id), eq(listDrafts.authorId, authorId)))
      .limit(1)
    // Ушёл ли черновик вперёд с тех пор, как его показали автору. Сравниваем ТОЛЬКО
    // когда вызывающий сказал, от какой редакции правил: MCP правит от свежего чтения
    // под тем же замком, ему сверять не с чем.
    const overwrote = draftMoved(opts.expected, before)

    const [row] = await tx
      .insert(listDrafts)
      .values({ templateId: tpl.id, authorId, baseVersion: tpl.currentVersion, items: data.items, meta: data.meta, note: data.note })
      .onConflictDoUpdate({
        target: [listDrafts.templateId, listDrafts.authorId],
        set: { items: data.items, meta: data.meta, note: data.note, rev: sql`${listDrafts.rev} + 1`, updatedAt: new Date() },
      })
      .returning({ id: listDrafts.id, rev: listDrafts.rev })
    return { id: row.id, rev: row.rev, overwrote }
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
  | { error: 'no draft' | 'stale' | 'empty' | 'out-of-sync' | 'moved'; message: string; currentVersion?: number; baseVersion?: number }

/**
 * Опубликовать черновик автора ОДНОЙ версией. Запись идёт обычным путём
 * (ListStore.addVersion → git-коммит в ядре), поэтому барьеры архива, заморозки и
 * модерации остаются на месте.
 *
 * expectedVersion — настоящая защита от гонки: ядро сверяет её внутри транзакции,
 * где строка списка уже взята for update. Сравнение чисел здесь — только ранний
 * отсев с понятным ответом.
 */
export async function publishDraftFor(
  tpl: ListRow,
  authorId: string,
  note?: string,
  opts: { expect?: DraftRef } = {},
): Promise<PublishResult> {
  const draft = await getDraft(tpl.id, authorId)
  if (!draft) return { error: 'no draft', message: 'there are no unpublished edits to publish' }
  // ⚠️ ПУБЛИКУЕТСЯ ИМЕННО ТОТ СНИМОК, который сохранили и показали. Запись держит замок
  // списка, но ОТПУСКАЕТ его, а сюда мы приходим отдельным чтением — в зазор успевает
  // `patch_list(publish:false)`: он поднимает ревизию, и в версию уходит его текст,
  // которого человек не видел. Удержание от затирания этого не ловит: оно смотрело
  // раньше зазора (P1 авто-ревью по #945).
  if (opts.expect && draftMoved(opts.expect, { id: draft.id, rev: draft.rev })) {
    return {
      error: 'moved',
      message: 'the draft changed after you saved it — reload the editor and publish again',
    }
  }
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
    // Черновик НЕ удаляем и ничего не теряем: правки остаются лежать до починки.
    if (e instanceof ListWriteError && e.code === 'out-of-sync') {
      return { error: 'out-of-sync', message: 'the list history is out of sync with its repository — publishing is on hold until it is repaired; the draft is kept' }
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
