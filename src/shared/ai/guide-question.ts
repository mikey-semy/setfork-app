/**
 * ВОПРОС «КТО ПОВЕДЁТ ПО ЭТОМУ ПУНКТУ» — одна формулировка на прод и на замер.
 *
 * Jev выбрал верного мастера на 57 пунктах из 57 (замер `scripts/gnome-routing-eval.ts`,
 * PR #961) именно с ЭТИМИ критериями и ЭТОЙ инструкцией. Поменять слово здесь — значит
 * встроить уже не то, что мерили; поэтому и кирка, и замер строят вопрос отсюда, а не
 * каждый своей копией.
 *
 * Чистый модуль (без server-only и БД): замер импортирует его вне Next.
 */
import type { DecideQuestion } from './decide'

/** Кандидат в проводники: то, что Jev о нём знает. */
export interface GuideCandidate {
  id: string
  /** Кто он — одной фразой, без точки: «a pragmatic DevOps/SRE expert». */
  about: string
  domains: string[]
}

/**
 * Разведчик — роль, а не ремесло (Belbin, Resource Investigator): он ищет инструменты и
 * ссылки для команды, а не ведёт по предмету. В правиле по доменам он тоже не участвует
 * (домен `*`). `id` гнома неприкосновенен (AGENTS.md §4), поэтому исключение по нему
 * устойчиво.
 */
export const GUIDE_EXCLUDED: ReadonlySet<string> = new Set(['hoarder'])

/**
 * «Кто он» — из персоны: её первое предложение (так же, как карточка `list_gnomes`), без
 * завершающей точки — иначе в критерии встала бы двойная.
 */
export function guideAbout(persona: string): string {
  const first = persona.split(/(?<=\.)\s/)[0] ?? persona
  return first.trim().replace(/\.$/, '')
}

export const GUIDE_INSTRUCTIONS =
  'A reader wants to dig deeper into THIS item of the list (not the list as a whole). Which specialist is the best guide for this specific item?'

/** Вопрос choice: вариант = id гнома, описание = кто он и его ремесло. */
export function guideQuestion(candidates: GuideCandidate[]): Extract<DecideQuestion, { type: 'choice' }> {
  const criteria = Object.fromEntries(
    candidates
      .filter((g) => !GUIDE_EXCLUDED.has(g.id))
      .map((g) => [
        g.id,
        g.domains.includes('*')
          ? `${g.about}. Pick ONLY when none of the other specialists' crafts fits the item.`
          : `${g.about}. Craft: ${g.domains.join(', ')}.`,
      ]),
  )
  return { type: 'choice', instructions: GUIDE_INSTRUCTIONS, criteria }
}

/** Состояние, о котором спрашивают: список (название, теги, раздел) и сам пункт. */
export function guideState(o: { listTitle: string; tags: string[]; section?: string | null; item: string }): string {
  return [`Список: ${o.listTitle}`, `Теги списка: ${o.tags.join(', ')}`, o.section ? `Раздел: ${o.section}` : null, `Пункт: ${o.item}`]
    .filter(Boolean)
    .join('\n')
}

/**
 * Вопрос noul «подходит ли пункт ремеслу ВЫБРАННОГО мастера».
 *
 * Уверенность choice говорит, насколько один кандидат оторвался от других, а не насколько
 * он подходит вообще: пункт про людей и процесс в опенсорсе ушёл программисту с
 * уверенностью 0,99, хотя настоящего мастера под него нет (разбор замера владельцем
 * 23.09.2026). Этот вопрос задаёт отдельный — пока в ТЕНИ: ответ пишется рядом с
 * решением и ни на что не влияет, пока его не откалибруют.
 */
export function fitsQuestion(g: GuideCandidate): Extract<DecideQuestion, { type: 'noul' }> {
  return {
    type: 'noul',
    instructions: `Specialist: ${g.about}. Craft: ${g.domains.join(', ')}. Does this item genuinely fall within this specialist's craft (not merely something they could comment on)?`,
  }
}
