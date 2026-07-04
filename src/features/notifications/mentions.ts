/**
 * Парсинг @-упоминаний из markdown-текста (issue, комментарии, правки).
 * Чистая функция без server-only/БД — удобно тестировать в изоляции.
 *
 * Handle совпадает с валидацией регистрации: [a-z0-9-]{3,30}.
 * Символ перед «@» не должен быть буквенно-цифровым/`_`/`/`/`@`/`-`, чтобы
 * не ловить e-mail (foo@bar), пути (a/@b) и повторные «@@».
 */
const MENTION_RE = /(^|[^a-zA-Z0-9_/@-])@([a-z0-9-]{3,30})\b/gi

/** Уникальные handle-и (в нижнем регистре) из текста; пустой массив, если нет. */
export function extractHandles(text: string | null | undefined): string[] {
  if (!text) return []
  const out = new Set<string>()
  for (const m of text.matchAll(MENTION_RE)) out.add(m[2].toLowerCase())
  return [...out]
}
