import { describe, expect, it, vi } from 'vitest'

/**
 * МАСТЕР ЗНАЕТ, КАК ЕГО ЗОВУТ.
 *
 * ⚠️ Имя и гильдия жили ТОЛЬКО в подписи интерфейса: в промпт уходила одна профессия
 * («a test engineer»). Владелец выбрал в чате раскопки Глоина, увидел его имя в шапке,
 * спросил «Глоин, а ты кто?» — и получил «я не Глоин, а Броккр»: модель придумала себе
 * имя из общего знания о гномах. Выглядело как сломанный выбор собеседника, хотя
 * отвечал ровно тот, кого позвали.
 *
 * Имя — не украшение: на нём держится и созыв коллеги («зову Фьялара»), и сам замысел
 * мастерской, где у ремесла есть цех, а у собеседника — имя.
 */
const h = vi.hoisted(() => ({ systems: [] as string[] }))

vi.mock('ai', () => ({
  generateText: async ({ system }: { system: string }) => {
    h.systems.push(system)
    return { text: 'ответ', usage: {}, providerMetadata: {} }
  },
}))
vi.mock('@/shared/settings/ai', () => ({ getAiSettings: async () => ({ enabled: true, temperature: 0.4, maxTokens: 600 }) }))
vi.mock('@/shared/ai/provider', () => ({ getAiChatClient: async () => ({ chat: (m: string) => m, cfg: { provider: 'test', models: ['m1'] } }) }))
vi.mock('@/shared/ai/credits', () => ({ pickChatModel: async () => 'm1' }))
vi.mock('@/shared/ai/usage', () => ({
  extractUsage: () => ({ input: 1, output: 1, total: 2, cost: 0 }),
  outcomeOf: () => 'ok',
  recordUsage: async () => {},
}))
vi.mock('@/shared/ai/gnome-character', () => ({ gnomeCard: () => ({ trait: 'спокойный', quirk: 'молчит о лишнем' }), rivalryHints: () => '' }))
vi.mock('@/shared/ai/gnome-reputation', () => ({
  gnomeMood: () => ({ style: '' }),
  gnomeReflection: () => '',
  gnomeReputation: async () => ({}),
  gnomeThanksCounts: async () => ({}),
  gnomeUserThanks: async () => 0,
  gnomeUserAccepts: async () => 0,
  repScore: () => 0,
  REP_MIN_GENS: 3,
}))

const { gnomeSpeak } = await import('@/shared/ai/gnomes')

const expert = (over: Record<string, unknown> = {}) =>
  ({
    id: 'tester',
    nameRu: 'Глоин',
    nameEn: 'Glóinn',
    persona: 'a test engineer.',
    domains: ['testing'],
    guildRu: 'Гильдия кодеров',
    guildEn: "Coders' Guild",
    code: '',
    codeRu: '',
    memory: '',
    ...over,
  }) as never

const chef = expert({ id: 'chef', nameRu: 'Фьялар', nameEn: 'Fjalarr', domains: ['готовка'], guildRu: 'Гильдия поваров', guildEn: "Chefs' Guild" })

const systemOf = async (e: never, over: Record<string, unknown> = {}) => {
  h.systems = []
  await gnomeSpeak(e, 'вопрос', { lang: 'ru', feature: 'dig', ...over } as never)
  return h.systems.join('\n')
}

describe('мастер знает своё имя', () => {
  it('имя уходит в промпт, а не только в подпись ленты', async () => {
    expect(await systemOf(expert()), 'мастер без имени выдумает себе чужое').toContain('Глоин')
  })

  it('имя на языке ответа: по-русски Глоин, а не Glóinn', async () => {
    const en = await systemOf(expert(), { lang: 'en' })
    expect(en).toContain('Glóinn')
    expect(await systemOf(expert())).toContain('Глоин')
  })

  it('гильдия названа: цех у мастера есть, и он о нём знает', async () => {
    expect(await systemOf(expert()), 'мастер не знает, к какому цеху принадлежит').toContain('Гильдия кодеров')
  })

  // ⚠️ Ремесло осталось на месте: имя ДОБАВЛЕНО к персоне, а не вместо неё — иначе
  // собеседник знает, как его зовут, и не знает, что умеет.
  it('профессия из персоны никуда не делась', async () => {
    expect(await systemOf(expert()), 'имя вытеснило ремесло').toContain('a test engineer')
  })

  it('созывая коллегу, мастер знает и ЕГО имя', async () => {
    const sys = await systemOf(expert(), { summonRoster: [expert(), chef] })
    expect(sys, 'зовущий выкрикнет техническую строку «зову chef»').toContain('Фьялар')
    expect(sys, 'id всё ещё нужен: по нему коллегу и находят').toContain('chef')
  })
})
