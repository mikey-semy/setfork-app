// Есть ли у списка перевод на язык — и, значит, нужно ли вообще звать модель.
// Чистый модуль без server-only: живёт отдельно от actions/ai.ts, потому что
// оттуда ('use server') нельзя экспортировать ничего, кроме async-функций, а
// это правило хочется проверять тестом, а не глазами.

import type { Lang, LocaleText, TKey } from '@/shared/i18n'

/**
 * ПОЧЕМУ ПЕРЕВОД НЕ СЛУЧИЛСЯ — одна таблица на все кнопки, которые его запускают.
 *
 * Их две (кнопка языка и пункт меню действий), и они уже разошлись: первая
 * расшифровывала код отказа, вторая показывала «не удалось перевести» на любой. Пока
 * таблица жила внутри компонента, второй вызывающий неизбежно заводил свою — ровно
 * так же, как это однажды случилось с кодами отказа версии (`VERSION_ERR`).
 *
 * `stale` — «список изменился, пока шёл перевод, и в свежем составе переводить уже
 * нечего». Причина названа, и следующий шаг тоже: нажать ещё раз, по новому тексту.
 * Показать здесь общее «не удалось» значило бы отправить человека жать кнопку в
 * надежде на другой ответ модели, хотя модель ни при чём.
 */
export function translateErrorKey(code: string): TKey {
  if (code === 'ratelimited') return 'rateLimited'
  if (code === 'ai_quota') return 'library.monthlyLimitReachedTry'
  if (code === 'stale') return 'translateListMoved'
  return 'translateFailed' // aifail / mismatch / notfound / прочее
}

/** Поле, которое нечего переводить или которое уже переведено. */
function done(v: unknown, lang: Lang): boolean {
  // Одноязычная строка (так хранились markdown-врезки до перевода): языкового
  // измерения нет вовсе, значит перевода нет. Пустая — переводить нечего.
  if (typeof v === 'string') return !v.trim()
  const lt = (v ?? {}) as LocaleText
  if (!Object.values(lt).some((s) => s?.trim())) return true
  return Boolean(lt[lang]?.trim())
}

export interface TranslatableRow {
  type: string
  title: unknown
  desc: unknown
  why: unknown
  subtasks: unknown
  refs: unknown
  content: unknown
}

/**
 * Готов ли список на этом языке целиком — то есть можно ли показать его,
 * ничего не переводя заново.
 *
 * Пустое поле считается готовым: переводить в нём нечего, и требовать от него
 * ключа языка значило бы гонять модель вечно из-за пустого «зачем».
 *
 * Проверяются ровно те поля, которые перевод и заполняет (translateList).
 * Считать готовым больше, чем переводится, — значит навсегда запретить
 * дозаполнение; меньше — значит звать модель на каждое нажатие.
 */
export function hasLang(
  tpl: { title: unknown; desc: unknown },
  rows: readonly TranslatableRow[],
  lang: Lang,
): boolean {
  if (!done(tpl.title, lang) || !done(tpl.desc, lang)) return false
  return rows.every((s) => {
    const fields: unknown[] = [s.title, s.desc, s.why, ...((s.subtasks ?? []) as unknown[])]
    for (const r of (s.refs ?? []) as { label?: unknown }[]) fields.push(r.label)
    // Врезка — единственное содержимое не-step блока, которое перевод трогает.
    if (s.type === 'text') fields.push((s.content as { md?: unknown } | null)?.md)
    return fields.every((f) => done(f, lang))
  })
}
