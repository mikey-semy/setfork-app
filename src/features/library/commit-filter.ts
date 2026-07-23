// Порог даты для фильтра «Коммитов» (?since=). Держим Date.now() в обычном
// util-модуле — в серверном компоненте вызов «нечистой» функции в рендере
// подсвечивает react-hooks/purity, здесь правило не действует.
const SINCE_MS: Record<string, number> = {
  day: 864e5,
  week: 7 * 864e5,
  month: 30 * 864e5,
  year: 365 * 864e5,
}

/** Возвращает нижнюю границу времени (мс-эпоха) для окна `since`, либо null («за всё время»). */
export function commitCutoff(since: string): number | null {
  const win = SINCE_MS[since]
  return win ? Date.now() - win : null
}
