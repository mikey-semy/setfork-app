// Перенос уже имеющихся переводов в новую версию.
//
// Редактор одноязычный: он показывает поле через tr() и на сохранении кладёт
// обратно ОДИН язык — `{ [lang]: value }`. Значит любая ручная правка стирала
// все остальные ключи, и перевод, сделанный кнопкой, жил ровно до следующего
// исправления опечатки. Здесь эти ключи возвращаются.
//
// Правило одно и оно языко-независимое (что важно: запись идёт не только из
// формы, но и из MCP, садовника и импорта, где «языка интерфейса» нет):
//
//   поле не изменилось → пишем прежнее значение целиком, со всеми языками;
//   поле изменилось    → пишем присланное, прежние переводы отбрасываем.
//
// Второе — не потеря, а честность: текст стал другим, и старый перевод к нему
// больше не относится. Кнопка «Перевести» увидит недостающий язык и доберёт
// его (translation-state.hasLang).
//
// Цена правила, названная вслух. Запись «не изменилось» возвращает ПРЕЖНЕЕ
// значение, а не сливает его с присланным, — значит перевод, дословно
// совпавший с оригиналом («Nginx» → «Nginx»), своего ключа не получит.
// Слияние здесь стоило бы дороже: поле, показанное откатом на другой язык и не
// тронутое человеком, записывалось бы как «переведено», а кнопка перевода
// после этого не показывается вовсе — язык остался бы недостижим. Потеря ключа
// у совпавшего текста не видна читателю (текст-то тот же), скрытая кнопка —
// видна сразу.
//
// Оттуда же следует: УДАЛИТЬ перевод, не тронув текст, этим путём нельзя —
// поле считается нетронутым, и языки возвращаются. Осознанно: спрос на «убрать
// один язык» гипотетический, а потеря переводов при обычной правке случалась
// каждый раз. Понадобится — это отдельная ручка, а не побочный эффект записи.

import { type LocaleText, tr } from '@/shared/i18n'

/** Что нужно знать о шаге прежней версии, чтобы перенести из него языки. */
export interface PrevStep {
  blockId?: string | null
  type?: string
  content?: Record<string, unknown> | null
  title?: LocaleText | null
  desc?: LocaleText | null
  why?: LocaleText | null
  needsHumanAsk?: LocaleText | null
  section?: LocaleText | null
  subtasks?: LocaleText[] | null
  refs?: { label?: LocaleText | null }[] | null
}

/** Шаг на записи — ровно те поля, которые тут читаются (структурно совместимо
 *  с NewStepInput, но без зависимости на core). */
export interface NextStep {
  blockId?: string | null
  type?: string
  content?: Record<string, unknown>
  title: LocaleText
  desc: LocaleText
  why: LocaleText
  needsHumanAsk?: LocaleText
  section: LocaleText
  subtasks: LocaleText[]
  refs: { label: LocaleText }[]
}

/**
 * Слить одно поле: изменилось — присланное, нет — прежнее целиком.
 *
 * Сравнение идёт с тем, что редактор ПОКАЗЫВАЛ, то есть с `tr(prev, key)` —
 * с учётом отката на другой язык. Иначе поле, показанное по фолбэку (перевода
 * на язык интерфейса ещё нет), считалось бы изменённым при каждом сохранении.
 *
 * И обратное: если оно показано по фолбэку и человек его не трогал, ключ языка
 * интерфейса НЕ добавляется. Добавить — значит записать английский текст как
 * русский перевод и навсегда убедить кнопку «Перевести», что переводить нечего.
 */
export function carryField(next: LocaleText | undefined, prev: LocaleText | null | undefined): LocaleText {
  const to = (next ?? {}) as LocaleText
  const from = (prev ?? {}) as LocaleText
  const keys = Object.keys(to)
  // Поле очистили (или его и не было) — так и записываем: возврат прежнего
  // значения означал бы, что удалить текст невозможно.
  if (!keys.length) return to
  if (!Object.keys(from).length) return to
  const changed = keys.some((k) => to[k] !== tr(from, k as never))
  return changed ? to : from
}

/** Позиционный перенос: сместили или переставили — значения не совпадут, и
 *  каждое такое поле уедет в ветку «изменилось». Чужой перевод не прилипнет. */
const carryList = (next: LocaleText[], prev: LocaleText[] | null | undefined): LocaleText[] =>
  next.map((v, i) => carryField(v, (prev ?? [])[i]))

/**
 * Markdown-врезка: у неё нет колонки, она лежит в content и до перевода
 * хранилась простой строкой. Языка интерфейса здесь взять негде, поэтому
 * «не изменилось» = строка совпала с ЛЮБЫМ из имеющихся языков.
 */
function carryMd(next: unknown, prev: unknown): unknown {
  if (typeof next !== 'string') return next // уже многоязычная (перевод) — не трогаем
  if (!next.trim()) return next
  if (typeof prev === 'string' || !prev) return next
  const from = prev as LocaleText
  const same = Object.values(from).some((v) => v === next)
  return same ? from : next
}

/**
 * Вернуть в новую версию языки, которые есть в текущей.
 *
 * Шаги сопоставляются по `blockId` — стабильной идентичности блока сквозь
 * версии (ADR-0013). По позиции не сопоставляем: вставка блока в середину
 * сдвинула бы всё, и перевод прилип бы к чужому пункту.
 */
export function carryTranslations<T extends NextStep>(next: readonly T[], prev: readonly PrevStep[]): T[] {
  const byId = new Map<string, PrevStep>()
  for (const p of prev) if (p.blockId) byId.set(p.blockId, p)
  if (!byId.size) return [...next]

  return next.map((s) => {
    const p = s.blockId ? byId.get(s.blockId) : undefined
    if (!p) return s
    const content =
      s.type === 'text' && s.content ? { ...s.content, md: carryMd(s.content.md, (p.content ?? {}).md) } : s.content
    return {
      ...s,
      content,
      title: carryField(s.title, p.title),
      desc: carryField(s.desc, p.desc),
      why: carryField(s.why, p.why),
      ...(s.needsHumanAsk === undefined ? {} : { needsHumanAsk: carryField(s.needsHumanAsk, p.needsHumanAsk) }),
      section: carryField(s.section, p.section),
      subtasks: carryList(s.subtasks, p.subtasks),
      refs: s.refs.map((r, i) => ({ ...r, label: carryField(r.label, (p.refs ?? [])[i]?.label) })),
    }
  })
}
