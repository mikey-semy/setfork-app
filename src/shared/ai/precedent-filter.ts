/**
 * Фильтр прецедентов по доменам гнома — этап 1 «базы знаний» плана мастерской:
 * повар получает в промпт кулинарные прецеденты, а не DevOps-списки. Семантическая
 * близость (pgvector в findPrecedents) уже отсеяла нерелевантное ГЛОБАЛЬНО; здесь —
 * второй, персональный срез по тегам списка × доменам эксперта.
 *
 * Чистый модуль (без server-only/БД) — юнит-тестируется. Структурная типизация
 * ({tags}) вместо импорта Precedent из retrieval: тому нужен server-only.
 */

/** Матч тега и домена: равенство или вхождение В ОБЕ стороны — теги свободные
 *  («приготовление», 'home-cooking'), домены короткие ('cooking', 'food'). */
function tagMatches(tag: string, domain: string): boolean {
  return tag === domain || tag.includes(domain) || domain.includes(tag)
}

/**
 * Выбрать прецеденты под эксперта. '*' в доменах (универсал, барахольщик) → просто топ
 * по близости. Ни один тег не совпал → фолбэк на топ: пустой контекст хуже общего
 * (прецеденты уже прошли порог смысловой близости к ЗАПРОСУ).
 */
export function pickPrecedents<T extends { tags: string[] }>(all: T[], domains: string[], limit = 3): T[] {
  if (domains.includes('*')) return all.slice(0, limit)
  const doms = domains.map((d) => d.toLowerCase().trim()).filter(Boolean)
  const matched = all.filter((p) => p.tags.some((t) => doms.some((d) => tagMatches(t.toLowerCase().trim(), d))))
  return (matched.length ? matched : all).slice(0, limit)
}
