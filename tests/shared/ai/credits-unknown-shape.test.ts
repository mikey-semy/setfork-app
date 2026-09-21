import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ОТВЕТ, КОТОРЫЙ МЫ НЕ ПОНЯЛИ, НЕ ОЗНАЧАЕТ «ДЕНЕГ НЕТ».
 *
 * Остаток на счету провайдера — один из двух предохранителей по деньгам, и он же
 * решает, работает ли ИИ вообще: при остатке ниже пола `globalBudgetOk` закрывает
 * генерацию НА ВСЁМ СТЕНДЕ.
 *
 * Разбор ответа делал два разных случая неразличимыми: `Number(undefined) || 0`
 * превращает «поля нет» в «на счету ноль». Достаточно провайдеру переименовать поле
 * или завернуть тело в ещё один слой — ответ 200 даёт remaining = 0, ноль ложится в
 * кеш как достоверный остаток и продлевается каждые 60 секунд. Продукт молча стоит,
 * а по логам — «всё хорошо, денег нет».
 *
 * Ответ, который мы не разобрали, — это сбой ЧТЕНИЯ, и обращаться с ним надо как со
 * сбоем HTTP: отдать прежнее значение. Вызывающий трактует отсутствие ответа как «не
 * знаем» и не блокирует; ноль он обязан принять всерьёз, потому что ноль значит, что
 * денег действительно нет.
 */
vi.mock('@/shared/settings/ai', () => ({
  getOpenRouterApiKey: async () => 'test-key',
  getModelSettings: async () => ({}),
}))

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response

async function load() {
  const mod = await import('@/shared/ai/credits')
  mod.clearCreditsCache()
  return mod
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

describe('остаток на счету: непонятый ответ ≠ ноль', () => {
  it('понятный ответ читается как есть', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ data: { total_credits: 10, total_usage: 4 } })))
    const { getOpenRouterCredits } = await load()
    expect(await getOpenRouterCredits()).toMatchObject({ total: 10, used: 4, remaining: 6 })
  })

  it('настоящий ноль остаётся нулём — иначе предохранитель перестанет срабатывать', async () => {
    // Обратная сторона: если «непонятно» и «ноль» перепутать в другую сторону, кончившиеся
    // деньги будут выглядеть как сбой чтения, и стенд продолжит тратить.
    vi.stubGlobal('fetch', vi.fn(async () => ok({ data: { total_credits: 7, total_usage: 7 } })))
    const { getOpenRouterCredits } = await load()
    expect(await getOpenRouterCredits()).toMatchObject({ remaining: 0 })
  })

  it.each([
    ['поле переименовали', { data: { credits_total: 10, usage_total: 4 } }],
    ['тело завернули ещё раз', { data: { data: { total_credits: 10, total_usage: 4 } } }],
    ['вместо объекта пришёл текст', { data: 'ok' }],
    ['поля пустые строки', { data: { total_credits: '', total_usage: '' } }],
    ['поля null', { data: { total_credits: null, total_usage: null } }],
  ])('%s → остаток НЕ выдумывается', async (_case, body) => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(body)))
    const { getOpenRouterCredits } = await load()
    const got = await getOpenRouterCredits()
    expect(got, 'непонятый ответ обязан дать «не знаем», а не остаток').toBeNull()
  })

  it('непонятый ответ НЕ затирает прежний известный остаток', async () => {
    // Главное следствие: один странный ответ не должен обнулять то, что мы знали.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: { total_credits: 100, total_usage: 10 } }))
      .mockResolvedValueOnce(ok({ data: { credits_total: 100 } }))
    vi.stubGlobal('fetch', fetchMock)
    const { getOpenRouterCredits } = await load()
    expect(await getOpenRouterCredits({ fresh: true })).toMatchObject({ remaining: 90 })
    expect(await getOpenRouterCredits({ fresh: true }), 'должен остаться прежний остаток').toMatchObject({ remaining: 90 })
  })

  it('число строкой читается: провайдер отдаёт деньги и так', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ data: { total_credits: '10.5', total_usage: '0.5' } })))
    const { getOpenRouterCredits } = await load()
    expect(await getOpenRouterCredits()).toMatchObject({ remaining: 10 })
  })
})
