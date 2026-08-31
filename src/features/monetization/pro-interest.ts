'use server'

import { eq, sql } from 'drizzle-orm'
import { db, proInterest } from '@/shared/db'
import { getSession } from '@/shared/auth/session'
import { rateLimit } from '@/shared/rate-limit'
import { recordAudit } from '@/shared/audit'
import { requestIp } from '@/shared/request-ip'

/**
 * Откуда пришла заявка — ЗАКРЫТЫЙ НАБОР, собранный из мест, которые её ставят.
 *
 * Значение приходит от клиента и уезжает в таблицу и журнал: незнакомая строка там —
 * запись, которую писали не мы, а по этим записям решается вопрос о деньгах.
 *
 * ⚠️ Список взят ИЗ КОДА (`ProInterestForm source=…`), а не придуман: первый раз я
 * написал его по памяти, и настоящее значение `list_quota` в него не попало — тест
 * поймал, что живая заявка записалась бы как «other». Заводя новое место показа формы,
 * добавьте его сюда, иначе замер потеряет, откуда пришли люди.
 */
const KNOWN_SOURCES = ['list_quota', 'settings', 'other'] as const

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
  // ⚠️ КЛЮЧ ГОСТЯ — ПО IP, А НЕ ПО ПОЧТЕ. Почту задаёт сам вызывающий: с ключом по ней
  // ограничитель не мешал ровно тому, ради чего написан — скрипт с сотней разных адресов
  // набивал бы сотню строк, и заодно накрутил бы порог «двадцать РАЗНЫХ людей», по
  // которому принимается решение о деньгах (0021). То есть замер спроса подделывался бы
  // тем же обращением, что и обходился лимит. Так же считает `feedback/actions.ts`.
  // ⚠️ Через общий помощник: `headers()` вне области запроса отказывает ДВУМЯ разными
  // способами, и своими руками это уже ломали. Нет IP — ключ «unknown»: гость без
  // адреса попадает в общее ведро, что строже, а не мягче.
  const key = session ? `pro-interest:u:${session.userId}` : `pro-interest:ip:${(await requestIp()) ?? 'unknown'}`
  if (!(await rateLimit(key, 5, 60 * 60_000)).ok) return { error: 'ratelimited' }

  // ⚠️ Источник — из ЗАКРЫТОГО набора: он приходит аргументом от клиента и уезжает в
  // таблицу и в журнал. Незнакомое значение не выбрасываем (замер важнее чистоты), но и
  // не храним как есть — иначе в отчёте о спросе появится строка, которую написал не мы.
  const src = (KNOWN_SOURCES as readonly string[]).includes(source) ? source : 'other'

  // Гонка: два одновременных обращения с одной почтой проходили проверку оба и давали
  // две строки и две записи в журнале. Считать людей это не мешало (счёт по distinct), а
  // вот список в админке двоился. Уникальный индекс + мягкая вставка.
  const inserted = await db
    .insert(proInterest)
    .values({ userId: session?.userId ?? null, email, source: src, note })
    .onConflictDoNothing({ target: proInterest.email })
    .returning({ id: proInterest.id })
  if (inserted.length === 0) return { ok: true, already: true }
  await recordAudit('pro.interest', { actorId: session?.userId ?? null, targetType: 'pro_interest', meta: { source: src } })
  return { ok: true, already: false }
}

