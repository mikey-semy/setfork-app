import 'server-only'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { db, generationMessages, generations } from '@/shared/db'

/**
 * Репутация гнома (слой «репутация», HQ §6): доля генераций с его черновиком,
 * где пользователь ПРИНЯЛ список. Ядро в shared/ai, а не в features — им
 * пользуется и совет (KPI-петля: репутация влияет на отбор экспертов), и чат
 * (бейдж). Кеш 5 минут: репутация меняется медленно, свежесть до минут — норм.
 */
export interface GnomeRep {
  gens: number
  accepted: number
}

/** Меньше — цифре нельзя верить: на 2 генерациях «50%» вводит в заблуждение. */
export const REP_MIN_GENS = 5

let cache: { at: number; data: Record<string, GnomeRep> } | null = null

export async function gnomeReputation(): Promise<Record<string, GnomeRep>> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.data
  try {
    const rows = await db
      .select({
        who: generationMessages.who,
        gens: sql<number>`count(distinct ${generations.id})::int`,
        accepted: sql<number>`count(distinct ${generations.id}) filter (where ${generations.chosenTemplateId} is not null)::int`,
      })
      .from(generationMessages)
      .innerJoin(generations, eq(generations.id, generationMessages.generationId))
      .where(and(eq(generationMessages.kind, 'draft'), isNotNull(generationMessages.who)))
      .groupBy(generationMessages.who)
    const data: Record<string, GnomeRep> = {}
    for (const r of rows) if (r.who) data[r.who] = { gens: r.gens, accepted: r.accepted }
    cache = { at: Date.now(), data }
    return data
  } catch {
    return cache?.data ?? {}
  }
}

/**
 * Балл гнома для взвешивания отбора [0..1]: доля принятых при доверии, иначе
 * нейтральные 0.5 (мало данных — не наказываем и не превозносим).
 */
export function repScore(rep: Record<string, GnomeRep>, id: string): number {
  const r = rep[id]
  if (!r || r.gens < REP_MIN_GENS) return 0.5
  return r.accepted / r.gens
}

/**
 * НАСТРОЕНИЕ гнома (RPG-развитие персоны, идея владельца): демеанор вытекает из
 * реального послужного списка и выражается в СТИЛЕ общения. Часто отклоняют →
 * ворчливый и обидчивый; часто принимают → окрылённый и щедрый. На тонких данных
 * (< порога) настроения нет — не судим по паре витков.
 *
 * Research-обоснование (PsyPlay/Big-Five 2025): дискретные уровни трейта, явно
 * инъецируемые в промпт. Возвращаем label (для UI) + style (директива шлифовке).
 */
export interface GnomeMood {
  label: string
  labelRu: string
  /** Короткая директива стиля для генерации реплик (пусто = базовый характер). */
  style: string
}

export function gnomeMood(rep: Record<string, GnomeRep>, id: string, thanks = 0): GnomeMood {
  const r = rep[id]
  // «Спасибо» — сильный тёплый сигнал (идея владельца: поблагодарят → добрый и
  // счастливый). Даже без достаточной статистики принятий пара благодарностей
  // делает гнома приветливым; много — согревает даже ворчуна.
  const warmed = thanks >= 2
  if (!r || r.gens < REP_MIN_GENS) {
    return warmed
      ? { label: 'content', labelRu: 'тронут', style: `warm and a little touched — someone thanked it${thanks >= 5 ? ' more than once' : ''}` }
      : { label: 'settled', labelRu: 'ровный', style: '' }
  }
  const rate = r.accepted / r.gens
  const seasoned = r.gens >= REP_MIN_GENS * 3
  const thanksNote = warmed ? '; and it has been thanked — that warms it up' : ''
  if (rate >= 0.6 || (warmed && rate >= 0.4))
    return {
      label: 'elated',
      labelRu: 'окрылённый',
      style: `upbeat, warm and generous with tips — its lists keep getting accepted${seasoned ? ', quietly proud of its craft' : ''}${thanksNote}`,
    }
  if (rate >= 0.4) return { label: 'content', labelRu: 'в духе', style: `confident and in good spirits, work is landing well${thanksNote}` }
  if (rate >= 0.2) return { label: 'wary', labelRu: 'задетый', style: `a touch self-doubting and terse, double-checks itself — lately often turned down${thanksNote}` }
  return {
    label: 'grumpy',
    labelRu: 'ворчливый',
    style: `grumbling and touchy, half-expects a rejection${seasoned ? ' after so many' : ''} — defensive but still professional and useful${thanksNote}`,
  }
}

/**
 * РЕФЛЕКСИЯ гнома (одушевление, слой памяти 3; идея владельца — гном от первого лица
 * о своём пути). Ортогональна настроению: mood — недавняя ДОЛЯ принятий (эмоция),
 * рефлексия — накопленный ОБЪЁМ карьеры (сколько списков людей выросло из его
 * черновиков) → стаж/самоощущение, от новичка до бывалого мастера. Можно быть
 * мастером (большой объём) и при этом в кислом настроении (недавняя полоса).
 * Растёт со временем; у новичка стажа нет → пусто (только заслуженное).
 *
 * Research: Generative Agents — рефлексия как синтез накопленного опыта в устойчивое
 * самоощущение поверх сиюминутных наблюдений.
 */
export function gnomeReflection(rep: Record<string, GnomeRep>, id: string): string {
  const accepted = rep[id]?.accepted ?? 0
  if (accepted >= 30) return 'a seasoned master — many lists out there carry your hand; let quiet, earned confidence show, nothing to prove'
  if (accepted >= 10) return 'you have a real track record now — a good number of lists were built on your drafts; speak with settled competence'
  if (accepted >= 3) return 'you are finding your footing — a few of your lists have stuck with people; a quiet note of growing confidence'
  return '' // новичок — стажа ещё нет, не выдумываем прошлое
}

/**
 * Эпизодическая память о СОБЕСЕДНИКЕ (идея владельца: «поблагодарят — запомнит»):
 * сколько раз ИМЕННО этот пользователь благодарил ИМЕННО этого гнома. Гном узнаёт
 * вернувшегося благодарного человека. Не кешируем (варьируется по паре гном×юзер);
 * запрос дешёвый — точечный по индексу gnome_thanks_gnome_idx, зовём лишь когда у
 * гнома вообще есть благодарности (см. gnomeSpeak). Сбой → 0 (память не критична).
 */
export async function gnomeUserThanks(gnomeId: string, userId: string): Promise<number> {
  try {
    const { gnomeThanks } = await import('@/shared/db')
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(gnomeThanks)
      .where(and(eq(gnomeThanks.gnomeId, gnomeId), eq(gnomeThanks.userId, userId)))
    return row?.n ?? 0
  } catch {
    return 0
  }
}

/**
 * Эпизодическая память о СОБЕСЕДНИКЕ, слой 2 (сигнал СИЛЬНЕЕ «спасибо»): сколько раз
 * ЭТОТ пользователь ПРИНЯЛ список из генерации, где ЭТОТ гном давал черновик — «ты уже
 * помогал этому человеку собрать список», он воспользовался твоей работой, а не просто
 * поблагодарил. Не кешируем (пара гном×юзер); запрос точечный (generations_user_idx),
 * зовём лишь у гномов с ненулевой репутацией принятий (см. gnomeSpeak). Сбой → 0.
 */
export async function gnomeUserAccepts(gnomeId: string, userId: string): Promise<number> {
  try {
    const [row] = await db
      .select({ n: sql<number>`count(distinct ${generations.id})::int` })
      .from(generationMessages)
      .innerJoin(generations, eq(generations.id, generationMessages.generationId))
      .where(
        and(
          eq(generationMessages.who, gnomeId),
          eq(generationMessages.kind, 'draft'),
          eq(generations.userId, userId),
          isNotNull(generations.chosenTemplateId),
        ),
      )
    return row?.n ?? 0
  } catch {
    return 0
  }
}

/** Сколько «спасибо» у каждого гнома (одушевление): питает настроение. Кеш 5 мин. */
let thanksCache: { at: number; data: Record<string, number> } | null = null
export async function gnomeThanksCounts(): Promise<Record<string, number>> {
  if (thanksCache && Date.now() - thanksCache.at < 5 * 60_000) return thanksCache.data
  try {
    const { gnomeThanks } = await import('@/shared/db')
    const rows = await db
      .select({ who: gnomeThanks.gnomeId, n: sql<number>`count(*)::int` })
      .from(gnomeThanks)
      .groupBy(gnomeThanks.gnomeId)
    const data: Record<string, number> = {}
    for (const r of rows) data[r.who] = r.n
    thanksCache = { at: Date.now(), data }
    return data
  } catch {
    return thanksCache?.data ?? {}
  }
}
