/**
 * Фильтр прецедентов по доменам гнома — этап 1 «базы знаний» плана мастерской:
 * повар получает в промпт кулинарные прецеденты, а не DevOps-списки. Семантическая
 * близость (pgvector в findPrecedents) уже отсеяла нерелевантное ГЛОБАЛЬНО; здесь —
 * второй, персональный срез по тегам списка × доменам эксперта.
 *
 * Чистый модуль (без server-only/БД) — юнит-тестируется. Структурная типизация
 * ({tags}) вместо импорта Precedent из retrieval: тому нужен server-only.
 */

/**
 * Матч тега и домена: равенство или вхождение В ОБЕ стороны — теги свободные
 * («приготовление», 'home-cooking'), домены короткие ('cooking', 'food').
 *
 * Экспортируется как ЕДИНСТВЕННАЯ доменная линза: тот же предикат уже был скопирован
 * в features/admin/hire.ts (сигнал найма) и понадобился раздаче садовничества по
 * профилю. Три копии одного правила разъезжаются — правило живёт здесь.
 */
export function tagMatches(tag: string, domain: string): boolean {
  return matchScore(tag, domain) > 0
}

/** Теги-отрицания: «not-programming» — это ПРОТИВОПОЛОЖНОСТЬ темы, а не тема. */
const NEGATED = /^(not|non|no|anti|без|не)[-_]/i
const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * Насколько тег отвечает домену: 2 — точное совпадение (тега или слова в нём),
 * 1 — слово начинается с домена («deployments» → 'deploy'), 0 — не отвечает.
 *
 * Почему не подстрока, как было: 'not-programming'.includes('programming') === true, и
 * кулинарный список с таким тегом уходил Кодеру (найдено прогоном раздачи ухода на
 * реальных данных). Тот же дефект бил и по фильтру прецедентов совета — программистские
 * прецеденты подмешивались к кулинарным запросам. Границу слова подстрока не видит.
 */
export function matchScore(tag: string, domain: string): number {
  const t = tag.toLowerCase().trim()
  const d = domain.toLowerCase().trim()
  if (!t || !d) return 0
  if (NEGATED.test(t)) return 0
  if (t === d) return 2
  const tw = words(t)
  const dw = words(d)
  if (tw.includes(d) || dw.includes(t)) return 2
  // Производные формы («deployments» → 'deploy', 'dev' → 'devops') — от 3 символов:
  // двухбуквенные по-прежнему заблокированы (исходный фикс ревью: 'go' ловил 'lego').
  if (d.length >= 3 && tw.some((w) => w.startsWith(d))) return 1
  if (t.length >= 3 && dw.some((w) => w.startsWith(t))) return 1
  return 0
}

/**
 * Насколько специалист «свой» для списка с такими тегами: число совпавших тегов.
 * '*' (универсал/барахольщик) осознанно даёт 0 — он берётся лишь как фолбэк, иначе
 * широкий домен всегда перебивал бы профильного мастера.
 */
export function domainAffinity(tags: string[], domains: string[]): number {
  if (domains.includes('*')) return 0
  const doms = domains.map((d) => d.toLowerCase().trim()).filter(Boolean)
  // Сумма ЛУЧШИХ оценок по каждому тегу: точное совпадение весит больше производного,
  // иначе при ничьей выигрывал просто тот, кто выше в ростере.
  return tags.reduce((sum, t) => sum + Math.max(0, ...doms.map((d) => matchScore(t, d))), 0)
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
