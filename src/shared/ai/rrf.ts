/**
 * Reciprocal Rank Fusion — слияние двух ранжированных выдач (гибридный поиск,
 * HQ research/2026-07-22 P1): score(d) = Σ 1/(60 + rank). k=60 — стандарт TREC;
 * документ, сильный в обеих ветках, всплывает наверх, слабые хвосты гаснут.
 * Чистый модуль — юнит-тестируется.
 */
export function rrf<T>(a: T[], b: T[], keyOf: (x: T) => string): T[] {
  const scores = new Map<string, { item: T; s: number }>()
  for (const list of [a, b]) {
    list.forEach((item, i) => {
      const k = keyOf(item)
      const cur = scores.get(k) ?? { item, s: 0 }
      cur.s += 1 / (60 + i + 1)
      scores.set(k, cur)
    })
  }
  return [...scores.values()].sort((x, y) => y.s - x.s).map((x) => x.item)
}
