'use server'

import { getLang } from '@/shared/i18n/server'
import { tr } from '@/shared/i18n'
// eslint-disable-next-line boundaries/dependencies -- канон собирает и разбирает git-ядро
import { snapshotSteps } from '@/features/git/snapshot-steps'
import type { ProposedItem } from '@/shared/db'
import { parseEditorItems, toEditorItems, toProposedItems, type EditorItem } from '../editor'
import { getStepPreviews } from '../queries'
import { toListContent } from '../list-content'
import { editableList, gitPort, ownerHandle } from './shared'

/**
 * Ф4 «правка списка как кода»: показать канон текстом и принять правку текста.
 *
 * Формат целиком принадлежит ядру: оно и собирает `list.json`, и разбирает его
 * строго. Фронт не сериализует и не валидирует — иначе правила формата живут в
 * двух реализациях и расходятся (та же причина, по которой удалён inproc-режим).
 *
 * Разобранный текст возвращается БЛОКАМИ редактора, а не сохраняется отдельным
 * путём: сохранение остаётся ровно одно — обычная кнопка формы. Второй путь записи
 * означал бы, что страж исполняемых команд, квоты и модерация должны быть
 * продублированы, а однажды один из дублей отстанет.
 */

/** Канон текстом по СОСТАВУ, который сейчас в редакторе, — вместе с несохранёнными
 *  правками. Показывать сохранённое, пока человек правит другое, значило бы
 *  показывать не тот текст, что он редактирует. */
export async function renderCanonAction(templateId: string, itemsJson: string): Promise<{ canon: string } | { error: string }> {
  const tpl = await editableList(templateId)
  if (!tpl) return { error: 'forbidden' }
  const lang = await getLang()
  const proposed: ProposedItem[] = toProposedItems(parseEditorItems(itemsJson), lang)
  const content = toListContent(
    proposed,
    {
      title: tr(tpl.title, lang),
      desc: tr(tpl.desc, lang),
      tags: tpl.tags,
      ordered: tpl.ordered,
      // Версия, которой правка СТАНЕТ: канон в git всегда несёт номер своей версии.
      version: tpl.currentVersion + 1,
    },
    lang,
  )
  const { gitCore } = await gitPort()
  const owner = await ownerHandle(tpl.ownerId)
  try {
    return { canon: await gitCore.renderCanon({ owner, slug: tpl.slug }, content) }
  } catch {
    // Ядро недоступно — это сбой сервиса, а не придирка к тексту.
    return { error: 'core-unavailable' }
  }
}

/** Разбор отредактированного текста. Придирки — обычный ответ: это разбор
 *  пользовательского ввода, и редактору нужен ВЕСЬ список сразу. */
export async function parseCanonAction(
  templateId: string,
  canon: string,
): Promise<
  | { items: EditorItem[] }
  | { issues: { path: string; code: string; message: string; line: number; column: number }[] }
  | { error: string }
> {
  const tpl = await editableList(templateId)
  if (!tpl) return { error: 'forbidden' }
  const lang = await getLang()
  const { gitCore } = await gitPort()
  const owner = await ownerHandle(tpl.ownerId)
  let res
  try {
    res = await gitCore.parseCanon({ owner, slug: tpl.slug }, canon)
  } catch {
    return { error: 'core-unavailable' }
  }
  if (res.issues.length > 0 || !res.content) return { issues: res.issues }
  // Строки канона → блоки редактора. Обе половины пути уже существуют и общие с
  // просмотром ветки: третьего конвертера шагов заводить нельзя.
  const rows = snapshotSteps({ ...res.content, tipSha: '' }) as unknown as ProposedItem[]
  // Превью картинок обязательны: канон несёт КЛЮЧ, а без подписанной ссылки блок
  // покажет пустой слот — и человек решит, что применение текста стёрло скриншот
  // (та же ловушка, что уже ловили на черновиках правок).
  const previews = await getStepPreviews(rows.map((r) => ({ imageKey: r.imageKey ?? null })))
  return { items: toEditorItems(rows, lang, previews) }
}
