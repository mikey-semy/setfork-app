import { tagMatches } from '@/shared/ai/precedent-filter'

/** То немногое от эксперта, что нужно выбору: кто он и в чём его ремесло. */
export interface PickableExpert {
  id: string
  domains: string[]
}

/**
 * КТО СПУСТИТСЯ В ШАХТУ — по ремеслу, а не по совпадению букв.
 *
 * ⚠️ Линза здесь НЕ СВОЯ: зовётся канон `tagMatches`. На этом месте жила четвёртая
 * копия правила, и работала она по подстроке — `'not-programming'.includes('programming')`
 * истинно, и список «не про программирование» доставался Кодеру. Тот же дефект уже
 * ловили на раздаче ухода и на фильтре прецедентов совета; в `precedent-filter` рядом с
 * каноном записано, почему правило живёт в одном месте: «три копии одного правила
 * разъезжаются».
 *
 * Порядок: явный выбор человека → мастер по ремеслу → универсал → хоть кто-то. Последние
 * два звена не украшение: без них вопрос по теме, которой в ростере нет, оставался бы
 * вовсе без ответа, а это хуже, чем ответ универсала.
 */
export function pickExpert<T extends PickableExpert>(
  roster: T[],
  tags: string[],
  chosenId?: string,
): T | undefined {
  if (chosenId && chosenId !== 'auto') {
    const picked = roster.find((e) => e.id === chosenId)
    if (picked) return picked
  }
  const lower = tags.map((t) => t.toLowerCase())
  return (
    roster.find((e) => !e.domains.includes('*') && e.domains.some((d) => lower.some((t) => tagMatches(t, d.toLowerCase())))) ??
    roster.find((e) => e.id === 'generalist') ??
    roster[0]
  )
}
