import 'server-only'
import { gnomeReputation, repScore } from '../gnome-reputation'
import type { Expert } from '../roster'

/**
 * Пол разнообразия: минимум два независимых мнения (мудрость толпы). Один черновик — это
 * уже не совет, а одиночная генерация под другим именем.
 */
const MIN_EXPERTS = 2

/**
 * Кого позвать в совет: названных распорядителем — по репутации, с добором до пола
 * разнообразия.
 *
 * KPI-петля (HQ §6, слой «репутация»): при ПРОЧИХ РАВНЫХ предпочитаем гномов с лучшим
 * послужным списком (доля принятых людьми). Репутация влияет только на ВЫБОР среди
 * кандидатов — не на то, кого вообще можно позвать: домен решает распорядитель. Так
 * «признание практикой» замыкается в поведение, а не только в бейдж.
 *
 * Добор идёт из ТОГО, ЧТО ВКЛЮЧЕНО (ростер уже отфильтрован по enabled). Раньше здесь
 * стоял поиск по хардкоду 'generalist'/'hoarder' с `!` — админ выключил универсала в зале
 * совета, и вся джоба падала (TypeError вне try → вечный pending). Универсал и барахольщик
 * приоритетны как дефолт-на-любую-тему, среди прочих равных — по репутации.
 */
export async function summonExperts(ctx: {
  /** Ростер целиком (только включённые). */
  roster: Expert[]
  /** id, названные распорядителем — могут быть выдуманными или выключенными. */
  summoned: string[]
  maxGnomes: number
}): Promise<Expert[]> {
  const { roster, summoned, maxGnomes } = ctx
  const rep = await gnomeReputation()
  const byReputation = (a: Expert, b: Expert) => repScore(rep, b.id) - repScore(rep, a.id)

  // Распорядитель мог назвать больше maxGnomes — оставляем не первых попавшихся, а самых уважаемых.
  const chosen = summoned
    .map((id) => roster.find((e) => e.id === id))
    .filter((e): e is Expert => Boolean(e))
    .sort(byReputation)
    .slice(0, maxGnomes)

  const defaultFirst = [...roster].sort((a, b) => {
    const rank = (e: Expert) => (e.id === 'generalist' ? 0 : e.id === 'hoarder' ? 1 : 2)
    return rank(a) - rank(b) || byReputation(a, b)
  })
  for (const g of defaultFirst) {
    if (chosen.length >= MIN_EXPERTS) break
    if (!chosen.some((e) => e.id === g.id)) chosen.push(g)
  }
  return chosen
}
