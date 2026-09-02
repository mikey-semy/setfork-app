import { cookies } from 'next/headers'
import { safeNext } from '@/shared/auth/safe-next'

/**
 * КУДА ВЕРНУТЬ ЧЕЛОВЕКА ПОСЛЕ ВХОДА ЧЕРЕЗ ВНЕШНЕГО ПРОВАЙДЕРА.
 *
 * Путь многоступенчатый: `/oauth/authorize` → `/login?next=…` → провайдер → его
 * callback → мы. Через провайдера параметры не проходят: он возвращает только `code` и
 * `state`. Поэтому цель поездки кладётся в куку на время перехода.
 *
 * ⚠️ ЭТО НЕ УДОБСТВО, А РАБОТОСПОСОБНОСТЬ ПОДКЛЮЧЕНИЯ. Раньше `finishOauthLogin` всегда
 * возвращал на главную: человек, начавший подключать MCP и вошедший через GitHub,
 * оказывался на главной, и подключение молча не состоялось. Со второго раза оно
 * работало — потому что сессия уже была и экран согласия открывался сразу. Владелец
 * прошёл ровно этот путь 02.09.2026 и описал его как «сначала просто зашлось на сайт».
 *
 * Кука живёт минуты и снимается при первом же использовании: задержавшаяся цель увела
 * бы человека в чужой поток при следующем обычном входе.
 */
const KEY = 'sf_after_login'
const TTL_SECONDS = 600

export async function rememberNext(next: string | null | undefined): Promise<void> {
  const value = safeNext(next, '')
  const c = await cookies()
  if (!value) {
    c.delete(KEY)
    return
  }
  c.set(KEY, value, {
    httpOnly: true,
    // `lax` обязателен: возврат от провайдера — навигация верхнего уровня с чужого
    // домена, и `strict` эту куку бы не прислал.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TTL_SECONDS,
  })
}

/**
 * Подсмотреть цель, НЕ снимая её. Нужно странице входа: после сорвавшегося перехода
 * она предлагает повторить, и ссылки повтора обязаны вести в тот же поток — иначе
 * человек снова окажется на главной, теперь уже осознанно нажав «войти».
 */
export async function peekNext(): Promise<string> {
  const c = await cookies()
  return safeNext(c.get(KEY)?.value, '')
}

/** Забрать цель и сразу забыть её. */
export async function takeNext(): Promise<string> {
  const c = await cookies()
  const raw = c.get(KEY)?.value
  if (raw) c.delete(KEY)
  return safeNext(raw, '')
}
