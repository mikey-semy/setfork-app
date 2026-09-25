import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { db, listDrafts, templates, type ProposedItem } from '@/shared/db'
import { AuthoredFilesError, ListWriteError, type AuthoredFile } from '@/core/ports'
import type { AuthoredText } from '@/core/domain/authored-path'
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
export type DraftSnapshot = { id: string; rev: number } | 'none'

/**
 * Что автор видел, когда открывал редактор: ВЕРСИЮ СПИСКА и состояние его черновика.
 *
 * ⚠️ Версия списка здесь не для красоты. Признак «строка + номер» опознаёт строку
 * черновика, а событие бывает и со СПИСКОМ: автор открыл редактор на версии N без
 * черновика, агент завёл черновик и ОПУБЛИКОВАЛ его как N+1 — строка исчезла, и автор
 * снова видит «черновика нет», своё исходное состояние. Совпадение полное, а правка
 * агента уже в версии. «Черновика не было при N» и «черновика нет при N+1» — разные
 * состояния (третий P1 авто-ревью по #945).
 */
export type DraftRef = { listVersion: number; draft: DraftSnapshot }

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
export function draftMoved(
  expected: DraftRef | undefined,
  now: { listVersion: number; draft: { id: string; rev: number } | undefined },
): boolean {
  if (expected === undefined) return false // путь MCP: правит от свежего чтения под тем же замком
  // Список ушёл вперёд, пока автор правил: между его «сейчас» и нашим что-то
  // опубликовали — в том числе, возможно, черновик агента, следа которого уже нет.
  if (expected.listVersion !== now.listVersion) return true
  // Строки нет. Это расхождение, если автор её ВИДЕЛ: её удалили при нём — опубликовали
  // или явно отбросили (`discard_draft`), — и сохранение из устаревшего редактора
  // воссоздало бы то, от чего отказались. Если автор её тоже не видел, расхождения нет.
  if (now.draft === undefined) return expected.draft !== 'none'
  if (expected.draft === 'none') return true // её не было при авторе — значит завели при нём
  return now.draft.id !== expected.draft.id || now.draft.rev !== expected.draft.rev
}

export async function upsertDraft(
  tpl: ListRow,
  authorId: string,
  data: { items: ProposedItem[]; meta: DraftMeta; note: string; authored?: AuthoredText[] | null },
  opts: { expected?: DraftRef } = {},
): Promise<{ id: string; rev: number; listVersion: number; overwrote: boolean }> {
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
    const overwrote = draftMoved(opts.expected, { listVersion: tpl.currentVersion, draft: before })

    const [row] = await tx
      .insert(listDrafts)
      .values({ templateId: tpl.id, authorId, baseVersion: tpl.currentVersion, items: data.items, meta: data.meta, note: data.note, authored: data.authored ?? null })
      .onConflictDoUpdate({
        target: [listDrafts.templateId, listDrafts.authorId],
        // Файлы — только когда их прислали: `undefined` значит «эта запись о файлах не
        // говорит», и правка, лёгшая в черновик раньше, остаётся.
        set: {
          items: data.items,
          meta: data.meta,
          note: data.note,
          ...(data.authored !== undefined ? { authored: data.authored } : {}),
          rev: sql`${listDrafts.rev} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: listDrafts.id, rev: listDrafts.rev })
    return { id: row.id, rev: row.rev, listVersion: tpl.currentVersion, overwrote }
  })
}

/** Убрать черновик автора (публикация его исчерпала либо от правок отказались). */
export async function deleteDraft(templateId: string, authorId: string): Promise<void> {
  await db.delete(listDrafts).where(and(eq(listDrafts.templateId, templateId), eq(listDrafts.authorId, authorId)))
}

/**
 * Убрать черновик, СНАЧАЛА сверив, тот ли он.
 *
 * ⚠️ Удаление — самое необратимое из трёх действий над рабочей копией, и именно оно
 * дольше всех обходилось без сверки: ранняя ветка «состав опустел» звала `deleteDraft`
 * раньше, чем признак вообще разбирался, а «отказаться от правок» не сверяла ничего и
 * сейчас. Человек убирал последний пункт — и правки агента исчезали без следа и без
 * предупреждения (P1 авто-ревью по #945).
 *
 * Сверка и удаление — под ОДНИМ замком списка: иначе между ними снова помещается
 * чужая запись, и мы удалим уже не то, что сравнивали.
 *
 * @returns `overwrote` — удалили не то, что видел автор. Удаление при этом НЕ
 * выполняется: необратимое действие поверх расхождения требует, чтобы человек
 * посмотрел ещё раз.
 */
export async function deleteDraftIfUnchanged(
  tpl: ListRow,
  authorId: string,
  expected: DraftRef | undefined,
): Promise<{ overwrote: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${templates} where ${templates.id} = ${tpl.id} for update`)
    const [before] = await tx
      .select({ id: listDrafts.id, rev: listDrafts.rev })
      .from(listDrafts)
      .where(and(eq(listDrafts.templateId, tpl.id), eq(listDrafts.authorId, authorId)))
      .limit(1)
    if (draftMoved(expected, { listVersion: tpl.currentVersion, draft: before })) return { overwrote: true }
    await tx.delete(listDrafts).where(and(eq(listDrafts.templateId, tpl.id), eq(listDrafts.authorId, authorId)))
    return { overwrote: false }
  })
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
  | { version: number; blocks: number; files?: number; filesNotApplied?: true }
  | {
      error: 'no draft' | 'stale' | 'empty' | 'out-of-sync' | 'moved' | 'files-invalid' | 'files-unsupported'
      message: string
      currentVersion?: number
      baseVersion?: number
      /** Текст ядра об отказе по файлам: он называет файл и предел. */
      detail?: string
    }

/** Файлы черновика → вход записи. Текст кодируется здесь: ядро держит байты. */
const toAuthoredFiles = (files: AuthoredText[]): AuthoredFile[] =>
  files.map((f) => ({ path: f.path, content: new TextEncoder().encode(f.text), executable: f.executable }))

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
  if (opts.expect && draftMoved(opts.expect, { listVersion: tpl.currentVersion, draft: { id: draft.id, rev: draft.rev } })) {
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
  let created: { version: number; authoredApplied?: boolean }
  try {
    created = await listStore.addVersion(tpl.id, {
      note: (note ?? draft.note).trim() || 'edit',
      steps: toStepInput(draft.items),
      authorId,
      meta: { tags, ordered },
      expectedVersion: draft.baseVersion,
      // Файлы не трогали — поля нет, ядро перенесёт набор родителя. Трогали — набор целиком.
      ...(draft.authored ? { authored: toAuthoredFiles(draft.authored) } : {}),
    })
  } catch (e) {
    // Файлы не приняты ДО записи — версии нет, черновик цел.
    if (e instanceof AuthoredFilesError) {
      return e.code === 'invalid'
        ? { error: 'files-invalid', message: `the git core refused the files: ${e.detail}`, detail: e.detail }
        : { error: 'files-unsupported', message: 'the git core does not accept author files yet — publish without file edits or try later' }
    }
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
  const thisRev = and(eq(listDrafts.templateId, tpl.id), eq(listDrafts.authorId, authorId), eq(listDrafts.rev, draft.rev))
  // Версия записана, а набор файлов ядро НЕ подтвердило (откатили между проверкой и
  // записью): блоки уже в версии, а правка файлов — нет. Её не выбрасываем: черновик
  // остаётся с одними файлами поверх новой версии, и следующая публикация их донесёт.
  const filesNotApplied = !!draft.authored && created.authoredApplied !== true
  if (filesNotApplied) await db.update(listDrafts).set({ baseVersion: created.version, updatedAt: new Date() }).where(thisRev)
  else await db.delete(listDrafts).where(thisRev)
  // Поиск обязан увидеть новую версию: без переиндексации он отдавал бы прошлую,
  // пока список не сохранят ещё раз. Оба входа (редактор и API) идут здесь.
  const { enqueueReindex } = await import('./jobs')
  await enqueueReindex(tpl.id)
  // Номер версии берём У ЯДРА, а не считаем: считать значит верить, что проекция
  // и нумерация никогда не расходятся.
  return {
    version: created.version,
    blocks: draft.items.length,
    ...(draft.authored ? { files: draft.authored.length } : {}),
    ...(filesNotApplied ? { filesNotApplied: true as const } : {}),
  }
}
