// Есть ли у списка перевод на язык — и, значит, нужно ли вообще звать модель.
// Чистый модуль без server-only: живёт отдельно от actions/ai.ts, потому что
// оттуда ('use server') нельзя экспортировать ничего, кроме async-функций, а
// это правило хочется проверять тестом, а не глазами.

import type { Lang, LocaleText } from '@/shared/i18n'

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
