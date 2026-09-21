import { createHash, randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ОДНОРАЗОВОЕ РАСХОДУЕТСЯ ОДИН РАЗ — В ТОМ ЧИСЛЕ ПРИ ОДНОВРЕМЕННОМ ПРЕДЪЯВЛЕНИИ.
 *
 * Код авторизации и refresh-токен одноразовы по спецификации, и оба гасились так:
 * прочитали строку → проверили в памяти, что ещё не использована → сделали безусловный
 * `update … where id = …`. Между чтением и записью помещается второй такой же обмен:
 * обе копии видят «не использован», обе гасят одну строку и обе получают токены.
 *
 * ⚠️ Корень — «снимок строки живёт дольше одной записи». Условие обязано стоять В САМОМ
 * `UPDATE`, а решение — приниматься по ЧИСЛУ затронутых строк, а не по тому, что мы
 * увидели секунду назад. Проверка в памяти выглядит как защита и ею не является.
 *
 * Тест на КЛАСС: оба одноразовых предмета проверяются одинаково, и добавить третий
 * будет стоить одной строки в перечне.
 */

const { db, users, oauthCodes, oauthRefreshTokens, apiTokens } = await import('@/shared/db')
const { exchangeCode, issueCode, refreshTokens } = await import('@/shared/auth/oauth-server')

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const CLIENT = 'https://claude.ai'
const RESOURCE = 'https://setfork.com/api/mcp'

let userId = ''

beforeEach(async () => {
  await resetTables([users, oauthCodes, oauthRefreshTokens, apiTokens])
  const [u] = await db.insert(users).values({ handle: 'oauth-race' }).returning({ id: users.id })
  userId = u.id
})

/** Свежий код вместе с его verifier — как их видит клиент. */
async function freshCode() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const code = await issueCode(
    {
      clientId: CLIENT,
      redirectUri: REDIRECT,
      codeChallenge: challenge,
      scope: 'write',
      resource: RESOURCE,
      state: 'st-1',
    },
    userId,
  )
  return { code, verifier }
}

const isPair = (r: unknown): boolean => !!r && typeof r === 'object' && 'accessToken' in (r as object)

describe('одноразовое нельзя израсходовать дважды', () => {
  it('ОДНОВРЕМЕННЫЕ обмены одного кода: пара токенов ровно одна', async () => {
    const { code, verifier } = await freshCode()

    // ⚠️ ТРИДЦАТЬ ДВА, и число выбрано замером, а не на глаз. С двумя гонка не ловится
    // почти никогда, с восемью — не ловится тоже: `exchangeCode` считает PKCE СИНХРОННО
    // и этим сериализует сам себя в одном процессе, так что первый успевает записать
    // `usedAt` раньше, чем остальные прочитают. Проверено на дефектном коде: 8 дают
    // один успех (тест зелёный при живой дыре), 32 дают тринадцать. На проде с
    // несколькими репликами сериализации нет вовсе, поэтому дефект там достижим легче,
    // чем в тесте. С условием в самом `UPDATE` результат перестаёт зависеть от
    // расписания: ровно один успех при любом числе одновременных.
    const results = await Promise.all(
      Array.from({ length: 32 }, () => exchangeCode({ code, verifier, redirectUri: REDIRECT, clientId: CLIENT })),
    )

    const ok = results.filter(isPair)
    expect(
      ok.length,
      'один код выдал две пары токенов: перехваченный работает столько раз, сколько его успеют предъявить',
    ).toBe(1)
  })

  it('ОДНОВРЕМЕННЫЕ обмены одного refresh: живая пара ровно одна', async () => {
    const { code, verifier } = await freshCode()
    const first = await exchangeCode({ code, verifier, redirectUri: REDIRECT, clientId: CLIENT })
    expect(isPair(first), 'предпосылка: первый обмен обязан пройти').toBe(true)
    const refresh = (first as { refreshToken: string }).refreshToken

    const results = await Promise.all(Array.from({ length: 32 }, () => refreshTokens(refresh, CLIENT)))

    const ok = results.filter(isPair)
    expect(
      ok.length,
      'один refresh дал две живые пары: ротация перестала обнаруживать кражу, ради чего она и заведена',
    ).toBe(1)
  })

  // ⚠️ Обратная сторона: правило, отвергающее и честное, бесполезно так же, как дырявое.
  it('законный ПОСЛЕДОВАТЕЛЬНЫЙ обмен работает: код → токены → обновление', async () => {
    const { code, verifier } = await freshCode()

    const pair = await exchangeCode({ code, verifier, redirectUri: REDIRECT, clientId: CLIENT })
    expect(isPair(pair), 'первый обмен кода обязан выдать токены').toBe(true)

    const next = await refreshTokens((pair as { refreshToken: string }).refreshToken, CLIENT)
    expect(isPair(next), 'обновление по свежему refresh обязано работать').toBe(true)

    // А повторный обмен того же кода — уже нет, и это не гонка, а обычная одноразовость.
    const again = await exchangeCode({ code, verifier, redirectUri: REDIRECT, clientId: CLIENT })
    expect(isPair(again), 'повторный обмен использованного кода обязан отказывать').toBe(false)
  })
})
