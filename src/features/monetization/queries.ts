import 'server-only'
import { sql } from 'drizzle-orm'
import { db, proInterest } from '@/shared/db'

/**
 * ⚠️ ЧТЕНИЕ ЖИВЁТ ЗДЕСЬ, А НЕ В `'use server'`-МОДУЛЕ. Каждый экспорт файла с этой
 * директивой — публичная точка входа, вызываемая из браузера. Счётчик заявок стоял там
 * без проверки прав, то есть любой мог узнать, сколько людей просят Pro, — число,
 * по которому принимается решение о деньгах. `server-only` делает такой вызов
 * невозможным по построению, а не по внимательности.
 */

/** Сколько ЛЮДЕЙ заявили интерес. Порог решения — 20 (0021), поэтому считаем людей. */
export async function countProInterest(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(distinct ${proInterest.email})::int` }).from(proInterest)
  return row?.n ?? 0
}
