import { describe, expect, it, vi } from 'vitest'

/**
 * ГНОМ ГОВОРИТ, СВОЯ ЛИ ПОД НИМ ЖИЛА.
 *
 * База знаний — то, чем гном отличается от чат-бота: он опирается на НАШУ библиотеку,
 * причём на прецеденты СВОЕГО ремесла (повар видит рецепты, а не деплой). Но линза
 * умеет не найти ничего, и тогда отдаётся общий фолбэк. Если об этом не сказать, гном
 * опирается на чужую жилу так же уверенно, как на свою, и человек не отличит «основано
 * на нашей библиотеке» от «основано на том, что подвернулось».
 *
 * ⚠️ Тот же признак совет уже пишет в провенанс (`noBasis`) — здесь он доезжает до
 * самого гнома, чтобы честность была в ответе, а не только в журнале.
 */

// Блок прецедентов уходит в PROMPT, а не в system: первая редакция теста смотрела
// только system и краснела не тем местом.
const h = vi.hoisted(() => ({ systems: [] as string[] }))

vi.mock('ai', () => ({
  generateText: async ({ system, prompt }: { system: string; prompt: string }) => {
    h.systems.push(`${system}\n${prompt}`)
    return { text: 'ответ гнома', usage: {}, providerMetadata: {} }
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
vi.mock('@/shared/ai/gnome-character', () => ({
  gnomeCard: () => ({ trait: 'спокойный', quirk: 'молчит о лишнем' }),
  rivalryHints: () => '',
}))
vi.mock('@/shared/ai/gnome-reputation', () => ({
  gnomeMood: async () => '',
  gnomeReflection: async () => '',
  gnomeReputation: async () => null,
  gnomeThanksCounts: async () => ({}),
  gnomeUserThanks: async () => 0,
  gnomeUserAccepts: async () => 0,
  repScore: () => 0,
  REP_MIN_GENS: 3,
}))

const { gnomeSpeak } = await import('@/shared/ai/gnomes')

const expert = {
  id: 'chef',
  nameRu: 'Повар',
  nameEn: 'Chef',
  persona: 'a cook',
  domains: ['cooking'],
  guildRu: '',
  guildEn: '',
  code: '',
  codeRu: '',
  memory: '',
  lens: '',
  enabled: true,
} as never

const ask = (over: Record<string, unknown>) => {
  h.systems = []
  return gnomeSpeak(expert, 'вопрос', {
    lang: 'ru',
    feature: 'dig',
    precedents: ['Рецепт супа — как варить'],
    ...over,
  } as never)
}

describe('честность опоры на библиотеку', () => {
  it('прецеденты НЕ его ремесла — гном предупреждён об этом', async () => {
    await ask({ precedentsOffCraft: true })
    const sys = h.systems.join('\n')
    expect(sys, 'гном выдаст чужую жилу за опыт своего цеха').toContain('none of these are from YOUR craft')
  })

  // ⚠️ Обратная сторона: если опора СВОЯ, оговорка лишняя — она заставит гнома
  // извиняться там, где он как раз на своём месте.
  it('прецеденты его ремесла — оговорки нет', async () => {
    await ask({ precedentsOffCraft: false })
    expect(h.systems.join('\n'), 'гном оправдывается на своей же жиле').not.toContain('none of these are from YOUR craft')
  })

  it('прецедентов нет вовсе — не упоминаем библиотеку', async () => {
    await ask({ precedents: [], precedentsOffCraft: true })
    const sys = h.systems.join('\n')
    expect(sys, 'обещали опору там, где её нет').not.toContain('SetFork knowledge base')
  })
})
