import 'server-only'
import { countDistinct, eq, sql } from 'drizzle-orm'
import { db, publiclyVisible, suggestions, templates } from '@/shared/db'

/**
 * ЧИСЛА ЛЕНДИНГА СЧИТАЮТСЯ ПО БАЗЕ. И НЕ ПОКАЗЫВАЮТСЯ, ПОКА МАЛЫ.
 *
 * До 02.09.2026 на витрине стояли «12k+ публичных списков», «48k+ улучшений»,
 * «2.3k+ авторов» — строки, вписанные руками. Это были не устаревшие данные: таких
 * чисел никогда не существовало, живой корпус на тот день — 24 публичных списка.
 *
 * ⚠️ ПОРОГ — НЕ ПРИДИРКА, А ЗАЩИТА ОТ САМОГО СЕБЯ. Двузначное число на витрине
 * работает против нас сильнее, чем его отсутствие: «24 списка» рядом с обещанием
 * «GitHub для списков» спорит само с собой, и читатель верит числу, а не обещанию.
 * Пустой слот честнее выдуманного, поэтому при малом корпусе блок не отдаётся вовсе —
 * лендинг просто не рисует секцию.
 *
 * Порог держим на сотне: это первое число, которое читается как «уже что-то есть», а
 * не как «здесь пусто». Меняя его, меняйте вместе с причиной.
 */
export const STATS_MIN_LISTS = 100

export type LandingStat = { num: string; label: string }

export type LandingCounts = { lists: number; contributions: number; makers: number }

/** Счёт по трём осям: публичные списки, принятые предложения правок, авторы этих списков. */
export async function landingCounts(): Promise<LandingCounts> {
  const [lists] = await db
    .select({ n: sql<number>`count(*)::int`, makers: countDistinct(templates.ownerId) })
    .from(templates)
    .where(publiclyVisible())
  // «Улучшения» — принятые предложения правок: то, что реально изменило чужой список.
  const [contributions] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(suggestions)
    .where(eq(suggestions.status, 'accepted'))

  return { lists: lists?.n ?? 0, contributions: contributions?.n ?? 0, makers: lists?.makers ?? 0 }
}

/**
 * Готовые плитки — или пусто, если показывать нечего. Числа без «+» и «k»: округление
 * вверх на маленьких значениях и есть тот самый обман, ради которого всё затевалось.
 */
export function statsFrom(counts: LandingCounts, labels: [string, string, string]): LandingStat[] {
  if (counts.lists < STATS_MIN_LISTS) return []
  // ⚠️ НОЛЬ НЕ ПОКАЗЫВАЕМ. Плитка «0 улучшений» не сообщает ничего, кроме «здесь
  // пусто», и работает против витрины ровно так же, как выдуманное число, — только
  // честно. Пропускаем её, остальные показываем как есть.
  return [
    { num: String(counts.lists), label: labels[0] },
    { num: String(counts.contributions), label: labels[1] },
    { num: String(counts.makers), label: labels[2] },
  ].filter((s) => s.num !== '0')
}
