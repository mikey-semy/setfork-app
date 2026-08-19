// Наложение плоской формы MCP на доменный блок. Причина измениться у модуля одна:
// появился тип блока или поле — правится карта здесь, а не путь записи.
//
// Модуль ЧИСТЫЙ: ни базы, ни транзакций. Всё, что он знает, — как перевести
// присланные агентом поля в блок, ничего не потеряв по дороге.

import { tr, trKey, type LocaleText } from '@/shared/i18n'
import type { ProposedItem } from '@/shared/db'
import { patchFields, type McpPatchOp } from '../../patch'
import { blockForMcp, toProposed, type DetailStep } from '../shared'

/** Строки версии → доменные блоки БЕЗ потерь: locale-JSON, content и идентичность
 *  как есть. Этим путём патч ведёт НЕТРОНУТЫЕ блоки: плоская MCP-форма отдаёт по
 *  одной строке на поле (переводы схлопнулись бы) и не знает про товары. */
export function rowsToProposed(rows: DetailStep[]): ProposedItem[] {
  return rows.map(
    (s) =>
      ({
        blockId: s.blockId ?? undefined,
        type: s.type ?? 'step',
        content: (s.content ?? {}) as Record<string, unknown>,
        title: s.title,
        desc: s.desc,
        command: s.command,
        hasImage: s.hasImage,
        imageKey: s.imageKey ?? undefined,
        level: s.level,
        why: s.why,
        section: s.section,
        needsHuman: s.needsHuman,
        needsHumanAsk: s.needsHumanAsk,
        // РАЗРУШИТЕЛЬНЫЙ ПУНКТ переносится наравне с остальным. Его тут не было, и пометка
        // молча слетала: `toStepInput` ставит `danger ?? isRiskyCommand(command)`, то есть
        // потерянное поле не остаётся пустым, а ПЕРЕСЧИТЫВАЕТСЯ по шаблону команды. Решение
        // автора — и «да, опасно» на безопасной с виду команде, и снятая пометка на
        // подозрительной — переживало ровно до первого патча СОСЕДНЕГО блока: состав
        // переписывается целиком, а danger в него не попадал. Замерено линзой ядра 02.
        danger: s.danger,
        subtasks: s.subtasks,
        refs: s.refs,
      }) as unknown as ProposedItem,
  )
}

/** Локализованные поля блока: их правка обязана дописываться В ЯЗЫК, а не поверх
 *  всего словаря — иначе патч по-английски стирает русский текст списка. */
const LOCALIZED = ['title', 'desc', 'why', 'section', 'needsHumanAsk'] as const

/** Поле входа MCP → ключ в content не-step блока. Нужен, чтобы отличить «поле не
 *  трогали» от «поле явно очистили»: сериализатор пустое и false опускает, и без
 *  этой карты очистка молча не применялась бы. */
const CONTENT_KEY: Record<string, string | undefined> = {
  text: 'md',
  ref: 'ref',
  imageRef: 'ref',
  url: 'url',
  name: 'name',
  fileName: 'name',
  caption: 'caption',
  question: 'question',
  options: 'options',
  multi: 'multi',
  deadline: 'deadline',
  explain: 'explain',
  quizKind: 'kind',
  accept: 'accept',
  caseSensitive: 'caseSensitive',
  answer: 'answer',
  tolerance: 'tolerance',
  template: 'template',
  blanks: 'blanks',
  pairs: 'pairs',
  sortItems: 'items',
}

/** Ключ локали, В КОТОРЫЙ ложится правка. Это ровно тот ключ, ОТКУДА чтение взяло
 *  показанное агенту значение (trKey повторяет выбор tr): у списка с двумя
 *  переводами `{ ru: 'старое', en: 'old' }` get_list отдаёт английский, и правка
 *  обязана лечь в en. Иначе она обновит русский, а наружу продолжит отдаваться
 *  прежний английский — правка выглядит принятой, но не видна. */
const langOfField = (lt: unknown): string => trKey(lt as LocaleText, 'en') ?? 'en'
const putLang = (before: unknown, flat: string): Record<string, string> => {
  const base = { ...((before ?? {}) as Record<string, string>) }
  const key = langOfField(before)
  // Очистка убирает ТОЛЬКО ту локаль, которую агент видел и стёр. Прежде она
  // сносила словарь целиком — правка «убрать описание» по-английски уносила с
  // собой и русское описание, которого агент даже не видел.
  if (flat.trim()) base[key] = flat.trim()
  else delete base[key]
  return base
}

/**
 * Наложить операцию update на существующий блок.
 *
 * Плоскую форму проходит ТОЛЬКО этот блок, и только ради полей, которые агент
 * действительно прислал: остальное берётся у прежнего блока как есть. Поэтому
 * перевод, картинка и содержимое непереданных полей переживают патч.
 */
export function patchBlock(item: ProposedItem, op: McpPatchOp): ProposedItem | { error: string } {
  const fields = patchFields(op)
  if (!Object.keys(fields).length) return { error: 'nothing to update — pass at least one field' }
  const type = item.type ?? 'step'
  // Товары через MCP пока не представлены (нет ни в чтении, ни во входе). Честный
  // отказ вместо тихого превращения подборки в пустой шаг.
  if (type === 'product') return { error: 'product blocks cannot be patched through the API yet' }
  if (fields.type && fields.type !== type) return { error: `cannot change block type (${type} → ${fields.type}); delete and insert instead` }

  const flatBefore = { ...blockForMcp(item as unknown as DetailStep), section: tr(item.section as LocaleText, 'en') || undefined }
  const [built] = toProposed([{ ...flatBefore, ...fields, type }])
  if (!built) return { error: 'the patch would leave the block empty (a step needs a title)' }

  const out = { ...built, blockId: item.blockId } as unknown as Record<string, unknown>
  // Снятая пометка «нужен человек» уносит и вопрос: иначе get_list продолжал бы
  // отдавать вопрос при снятой пометке, а повторное включение воскрешало старый.
  const clears = new Set<string>(Object.keys(fields))
  if (fields.needsHuman === false) clears.add('needsHumanAsk')
  for (const f of LOCALIZED) {
    out[f] = clears.has(f) ? putLang(item[f], tr(built[f] as LocaleText, 'en')) : item[f]
  }
  // Списки локализованных значений сопоставляем по ПОКАЗАННОМУ тексту, а не по
  // позиции: вставка в начало сдвигала бы переводы на соседние пункты — русский
  // текст оказывался у чужой проверки. Совпал текст — элемент тот же, словарь
  // переносим целиком; не совпал — это новое значение, пишем в язык блока.
  const blockLang = langOfField(item.title)
  const pickLocales = (oldList: LocaleText[], flat: string): LocaleText => {
    const same = oldList.find((o) => tr(o, 'en') === flat)
    return same ?? ({ [blockLang]: flat } as LocaleText)
  }
  const oldSubs = (item.subtasks ?? []) as LocaleText[]
  out.subtasks = 'subtasks' in fields ? (built.subtasks ?? []).map((s) => pickLocales(oldSubs, tr(s as LocaleText, 'en'))) : oldSubs
  const oldRefs = (item.refs ?? []) as { label: LocaleText; url?: string }[]
  out.refs =
    'refs' in fields
      ? (built.refs ?? []).map((r) => ({
          label: pickLocales(oldRefs.map((x) => x.label), tr(r.label as LocaleText, 'en')),
          ...(r.url ? { url: r.url } : {}),
        }))
      : oldRefs
  // Ключи content, которых плоская форма не знает, сохраняем: иначе патч соседнего
  // поля вычищал бы всё, что MCP пока не умеет представлять (например товары).
  const oldContent = (item.content ?? {}) as Record<string, unknown>
  const newContent = (built.content ?? {}) as Record<string, unknown>
  const content: Record<string, unknown> = { ...oldContent, ...newContent }
  // …но ЯВНАЯ очистка обязана срабатывать. Сериализатор опускает пустое и false
  // (multi: false, пустой deadline/caption/explain) — при простом слиянии поверх
  // старого значения такая правка не делала бы ничего, а ответ был бы успешным.
  for (const field of Object.keys(fields)) {
    const key = CONTENT_KEY[field]
    if (key && !(key in newContent)) delete content[key]
  }
  out.content = content
  return out as unknown as ProposedItem
}
