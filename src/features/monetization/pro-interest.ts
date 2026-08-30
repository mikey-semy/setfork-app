'use server'

import { eq, sql } from 'drizzle-orm'
import { db, proInterest } from '@/shared/db'
import { getSession } from '@/shared/auth/session'
import { rateLimit } from '@/shared/rate-limit'
import { recordAudit } from '@/shared/audit'

/**
 * ЗАЯВКА «ХОЧУ PRO» — запись интереса, а не подписка (решение 0021).
 *
 * Отвечает значением, а не переходом: форма стоит внутри сообщения об ограничении, и
 * унести человека со страницы значило бы отобрать у него то, ради чего он сюда пришёл.
 *
 * ⚠️ ПОВТОРНАЯ ЗАЯВКА С ТОЙ ЖЕ ПОЧТЫ НЕ СЧИТАЕТСЯ ДВАЖДЫ. Порог решения — двадцать
 * ЛЮДЕЙ, а не двадцать нажатий: посчитать одного человека за двадцать значит принять
 * решение о платёжке по собственному шуму.
 */
export type ProInterestResult = { ok: true; already: boolean } | { error: 'bad-email' | 'ratelimited' }

/** Проверка почты — намеренно грубая: строгая ловит опечатки, но режет живые адреса. */
const LOOKS_LIKE_EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/

export async function expressProInterest(source: string, formData: FormData): Promise<ProInterestResult> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  const note = String(formData.get('note') ?? '').trim().slice(0, 500)
  if (!LOOKS_LIKE_EMAIL.test(email)) return { error: 'bad-email' }

  const session = await getSession()
  // Анти-спам: заявка пишет в нашу таблицу и влияет на решение о деньгах — набить её
  // сотней строк с одного места стоило бы минуту.
  if (!(await rateLimit(`pro-interest:${session?.userId ?? email}`, 5, 60 * 60_000)).ok) return { error: 'ratelimited' }

  const [existing] = await db.select({ id: proInterest.id }).from(proInterest).where(eq(proInterest.email, email)).limit(1)
  if (existing) return { ok: true, already: true }

  await db.insert(proInterest).values({ userId: session?.userId ?? null, email, source: source.slice(0, 100), note })
  await recordAudit('pro.interest', { actorId: session?.userId ?? null, targetType: 'pro_interest', meta: { source } })
  return { ok: true, already: false }
}

/** Сколько ЛЮДЕЙ заявили интерес. Порог решения — 20 (0021), поэтому считаем людей. */
export async function countProInterest(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(distinct ${proInterest.email})::int` }).from(proInterest)
  return row?.n ?? 0
}
