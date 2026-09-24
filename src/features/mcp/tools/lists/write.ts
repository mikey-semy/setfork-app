// Общая половина записи: найти свой список, положить новый состав блоков.
// Причина измениться одна — как список попадает на запись (владение, прежние
// адреса, черновик против опубликованного, отказ ядра по устаревшей версии).
//
// Путь один намеренно: update_list и patch_list приходят сюда оба. Писать список
// двумя разными путями значит рано или поздно расхождение между ними.

import 'server-only'
import { eq } from 'drizzle-orm'
import { db, templates, type ProposedItem } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import { AuthoredFilesError, canEditList, ListWriteError, type AuthoredFile } from '@/core'
import { DestructiveCommandError } from '@/core/domain/destructive-command'
import { listStore } from '@/features/library/list-store'
// Единый конвертер шагов на запись — тот же, что у веба, садовника и предложений.
// Своя копия в MCP теряла blockId и «здесь нужен человек» (см. комментарий в модуле).
import { toStepInput as stepInput } from '@/shared/lib/step-input'
import { resolveListRefOrMoved } from '../shared'
import { duplicateBid } from './draft-store'

/** Отказ стража разрушительных команд → ответ инструмента. Это не сбой, а
 *  вердикт: агенту нужно назвать причину, а не увидеть стектрейс. Опасное в файле из
 *  `scripts/` называется файлом: «шаг 0» агент не нашёл бы нигде. */
export const destructiveError = (e: unknown): { error: string } | null =>
  e instanceof DestructiveCommandError
    ? e.path
      ? { error: `refused: ${e.path} has a destructive command (${e.reason}): ${e.fragment}` }
      : { error: `refused: step ${e.stepIndex} has a destructive command (${e.reason}): ${e.fragment}` }
    : null

/** Отказ по файлам автора → ответ инструмента: набор не прошёл правило дерева (текст ядра
 *  называет файл и предел) или ядро файлов не понимает — тогда повтор сейчас бесполезен. */
export const authoredError = (e: unknown): { error: string } | null =>
  e instanceof AuthoredFilesError
    ? e.code === 'invalid'
      ? { error: `refused: the files do not fit the skill tree — ${e.detail}` }
      : { error: `refused before writing: ${e.detail || 'the git core does not accept author files yet'} — nothing was written; the blocks can still be saved without files (update_list / patch_list)` }
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
  // Отказ называет СЛЕДУЮЩИЙ ШАГ: чужой список правится предложением, а не запретом.
  // Голое «forbidden» — тупик: агент либо сдаётся, либо перебирает вызовы наугад.
  if (tpl.ownerId !== userId)
    return { error: 'forbidden: you are not the owner — use suggest_edit to propose a change to a list you do not own' as const }
  // Архив/заморозка: гейт нужен ЗДЕСЬ, а не только в фасадном бэкстопе addVersion —
  // мета (tags/ordered) обновляется до версии и не должна утечь в read-only список.
  if (!canEditList(tpl)) return { error: 'forbidden: list is archived or frozen' as const }
  return { tpl }
}

/** Записать НОВЫЙ состав блоков (доменная форма) — новой версией через ядро. Общая половина
 *  update_list и patch_list: писать список двумя разными путями значит рано или поздно
 *  расхождение, и однажды оно уже случилось — см. комментарий ниже. */
export async function writeProposed(
  tpl: NonNullable<Awaited<ReturnType<typeof ownedList>>['tpl']>,
  handle: string,
  slug: string,
  proposed: ProposedItem[],
  note: string,
  // title/desc — только когда их меняют: патч меты, отсутствующее поле ядро не трогает.
  meta: { tags: string[]; ordered: boolean; title?: LocaleText; desc?: LocaleText },
  // Версия, от которой собран состав. ОБЯЗАТЕЛЬНА, а не «если знаете»: необязательной
  // она была ровно один вызов, и `update_list` её не передавал — полная замена уезжала
  // в ядро без сверки и молча вытесняла чужую версию, пока патч был защищён.
  expectedVersion: number,
  // Файлы автора тем же коммитом (ADR-0028). Не задано — ядро переносит их из родителя.
  authored?: AuthoredFile[],
) {
  if (!proposed.length) return { error: 'at least one item with a title is required' }
  const dup = duplicateBid(proposed)
  if (dup) return { error: `two blocks share the same bid "${dup}" — a block id must be unique within a list` }

  // ЧЕРНОВИК ПИШЕТСЯ ТАК ЖЕ, КАК ВСЁ ОСТАЛЬНОЕ. Здесь была ветка «перезаписать текущую
  // версию на месте, без плодения версий»: она шла прямо в Postgres, мимо фасада — то есть
  // мимо ядра, которое одно создаёт коммит. Линза ядра 02 измерила цену (19.08): git о такой
  // правке не узнавал НИКОГДА, публикация списка её не выравнивала, и сайт показывал одно, а
  // `git clone` отдавал другое. Хуже: при потере тома ядро материализует репозиторий из
  // Postgres — и та же версия v1 получала другое содержимое и другой SHA, то есть
  // восстановление переписывало историю.
  //
  // Копить правки без версий по-прежнему можно и нужно — но рабочей копией (publish:false),
  // общей с редактором, а не вторым путём записи (ADR-0020).
  // tags/ordered едут ВНУТРИ addVersion (Ф2a-довесок): ядро применяет мету той же
  // транзакцией, что и версию, — канон коммита сразу несёт свежие значения.
  // expectedVersion (если задан) ядро сверяет ТАМ ЖЕ: сравнение и запись под одним
  // замком строки, иначе между ними успевает лечь чужая версия.
  let ver
  try {
    ver = await listStore.addVersion(tpl.id, { note, steps: stepInput(proposed), meta, expectedVersion, authored })
  } catch (e) {
    // Отказ ядра по устаревшей версии — не сбой, а нормальный исход гонки: пока
    // правку готовили, список ушёл вперёд. Агент перечитывает и накладывает заново.
    // Текст НЕЙТРАЛЕН к инструменту: сюда приходят и патч, и полная замена, а «rebuild
    // the ops» отправляло бы автора полной замены собирать то, чего он не посылал.
    if (e instanceof ListWriteError && e.code === 'stale')
      return { error: 'list changed while the edit was being written — read it again (get_list) and rebuild the change from the version it returns' }
    // Повторять НЕ предлагаем: расхождение git и базы чинит человек, и агент,
    // которому сказали «попробуй снова», будет долбиться в отказ бесконечно.
    if (e instanceof ListWriteError && e.code === 'out-of-sync')
      return { error: 'the list history is out of sync with its repository — writing is on hold until it is repaired, do not retry' }
    // Вердикт стража разрушительных команд — тоже ответ, а не сбой: агенту нужно назвать
    // причину. Раньше он превращался в ответ только в ветке правки черновика; когда та
    // ушла, стражевой отказ полетел исключением — то есть агент получал бы стектрейс
    // вместо «отказано, потому что».
    const refused = destructiveError(e) ?? authoredError(e)
    if (refused) return refused
    throw e
  }
  // Пере-проверку публичного списка делает фасад listStore.addVersion (барьер): нарушающие
  // БЛОКИ, залитые через MCP, модерацию не минуют. ⚠️ Тексты файлов автора (references/,
  // assets/) модерация не читает — ни здесь, ни на push: это открытый вопрос ADR-0028.
  const { enqueueReindex } = await import('@/features/library/jobs')
  await enqueueReindex(tpl.id)
  // Статус отдаём НАСТОЯЩИЙ: он был захардкожен 'published', и черновик, получив версию,
  // отвечал агенту «опубликован» — то есть врал про видимость ровно там, где агент решает,
  // показывать ли ссылку человеку.
  return { ref: `${handle}/${slug}`, status: tpl.status, version: ver.version, authoredApplied: ver.authoredApplied }
}
