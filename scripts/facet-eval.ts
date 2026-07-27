/**
 * facet-eval.ts — ЗАМЕР МНОГОГРАННОСТИ совета по сохранённым черновикам.
 *
 * Смысл совета (решение владельца) — не добротность, а РАЗНЫЕ УГЛЫ ЗРЕНИЯ: инновация
 * возникает из скрещивания сфер. Значит и мерить надо не «правильность», а покрытие
 * граней: сколько СВОИХ, ни у кого больше не встречающихся тем принёс каждый участник —
 * и сколько из них старейшина ПОТЕРЯЛ при сведении.
 *
 * Почему офлайн: замер, который сам стоит денег, делают редко — а значит им не пользуются.
 * Здесь считается то, что уже лежит в generation_drafts и generation_candidates: ни одного
 * вызова модели, ни одного запроса в сеть. Гонять можно когда угодно.
 *
 * Метод (leave-one-out по участникам, arXiv 2605.27621 «Agents that Matter»: N прогонов
 * «минус участник i» дают тот же вывод об узких местах, что Шепли, за долю цены — только у
 * нас даже прогонов не нужно, всё уже записано):
 *   1. грань = нормализованный ключ пункта (заголовок без регистра/пунктуации/стоп-слов);
 *   2. уникальная грань участника = ключ, которого нет ни в одном ЧУЖОМ черновике;
 *   3. доезжаемость = доля уникальных граней участника, попавших в финальный список;
 *   4. потеря синтеза = уникальные грани, которые старейшина выбросил.
 *
 * Что этим проверяется прямо: если у совета высокая доля уникальных граней, но низкая
 * доезжаемость — совет РАБОТАЕТ, а синтез схлопывает разнообразие в среднее, и лечить надо
 * промпт старейшины (MAS-PromptBench: у синтезатора рычаг, у персон — нет). Если уникальных
 * граней мало — многогранность не возникает вовсе, и совет не окупает ×6–7 цены.
 *
 * Запуск: npx tsx scripts/facet-eval.ts
 */
import { inArray } from 'drizzle-orm'
import { db, generationCandidates, generationDrafts, type CandidateItem } from '../src/shared/db'
import { contribution, facetsOfDraft, facetsOfFinal, share } from '../src/shared/ai/facets'

interface PersonaStat {
  who: string
  drafts: number
  facets: number
  unique: number
  delivered: number
}

async function main() {
  const rows = await db.select().from(generationDrafts)
  if (!rows.length) {
    console.log('черновиков совета в базе нет — сначала прогони совет (данные пишутся с этого PR)')
    console.log('замер по УЖЕ прошедшим виткам невозможен: их черновики выбрасывались.')
    process.exit(0)
  }

  // Витки: (generationId, idx) → черновики + финальный список.
  const byRun = new Map<string, typeof rows>()
  for (const r of rows) {
    const k = `${r.generationId}:${r.idx}`
    byRun.set(k, [...(byRun.get(k) ?? []), r])
  }
  const cands = await db
    .select({ generationId: generationCandidates.generationId, idx: generationCandidates.idx, items: generationCandidates.items })
    .from(generationCandidates)
    .where(inArray(generationCandidates.generationId, [...new Set(rows.map((r) => r.generationId))]))
  const finalOf = new Map(cands.map((c) => [`${c.generationId}:${c.idx}`, c.items as CandidateItem[]]))

  const perPersona = new Map<string, PersonaStat>()
  let runs = 0
  let synthLost = 0
  let synthKept = 0
  let ownFacetsTotal = 0

  for (const [key, drafts] of byRun) {
    const final = finalOf.get(key)
    if (!final?.length || drafts.length < 2) continue // нечего сравнивать
    runs++
    const finalFacets = facetsOfFinal(final)
    const facetsBy = new Map(drafts.map((d) => [d.letter, facetsOfDraft(d.text)]))

    for (const d of drafts) {
      const mine = facetsBy.get(d.letter) ?? new Set<string>()
      const others = new Set<string>()
      for (const [letter, set] of facetsBy) if (letter !== d.letter) for (const f of set) others.add(f)

      const { unique, delivered } = contribution(mine, others, finalFacets)
      ownFacetsTotal += mine.size
      synthKept += delivered.length
      synthLost += unique.length - delivered.length

      const st = perPersona.get(d.who) ?? { who: d.who, drafts: 0, facets: 0, unique: 0, delivered: 0 }
      st.drafts++
      st.facets += mine.size
      st.unique += unique.length
      st.delivered += delivered.length
      perPersona.set(d.who, st)
    }
  }

  if (!runs) {
    console.log(`черновики есть (${rows.length}), но сопоставимых витков нет: нужен финальный список и ≥2 черновика`)
    process.exit(0)
  }

  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—')
  console.log('\n=== Многогранность совета (LLM не звался) ===')
  console.log(`витков: ${runs} · черновиков: ${rows.length} · граней всего: ${ownFacetsTotal}`)
  console.log(`уникальных граней доехало до финала: ${synthKept}, потеряно синтезом: ${synthLost} (${pct(synthLost, synthKept + synthLost)} уникального выброшено)`)

  console.log('\nпо участникам (грани / из них уникальные / из уникальных доехало):')
  const sorted = [...perPersona.values()].sort((a, b) => b.unique - a.unique)
  for (const p of sorted) {
    console.log(
      `  ${p.who.padEnd(14)} витков ${String(p.drafts).padStart(3)} · граней ${String(p.facets).padStart(4)} · уникальных ${String(p.unique).padStart(4)} (${pct(p.unique, p.facets)}) · доехало ${String(p.delivered).padStart(4)} (${pct(p.delivered, p.unique)})`,
    )
  }

  // Читатель не должен сам додумывать вывод — пишем, что эти числа значат.
  const uniqueShare = ownFacetsTotal ? (synthKept + synthLost) / ownFacetsTotal : 0
  const deliverShare = synthKept + synthLost ? synthKept / (synthKept + synthLost) : 0
  console.log('\nчто это значит:')
  if (uniqueShare < 0.15) {
    console.log(`  • уникальных граней мало (${Math.round(uniqueShare * 100)}% от всех) — участники пишут ОДНО И ТО ЖЕ.`)
    console.log('    Многогранность не возникает; совет за ×6–7 цены покупает мало. Лечить: разнести персон по')
    console.log('    доменам и семействам моделей, а не добавлять ещё экспертов.')
  } else {
    console.log(`  • уникальные грани есть (${Math.round(uniqueShare * 100)}% от всех) — разные углы зрения РЕАЛЬНЫ.`)
  }
  if (deliverShare < 0.5) {
    console.log(`  • но до финала доезжает лишь ${Math.round(deliverShare * 100)}% уникального — СИНТЕЗ схлопывает разнообразие.`)
    console.log('    Рычаг у промпта старейшины (MAS-PromptBench: у синтезатора он есть, у персон почти нет).')
  } else {
    console.log(`  • синтез сохраняет ${Math.round(deliverShare * 100)}% уникального — старейшина не усредняет.`)
  }
  process.exit(0)
}

void main()
