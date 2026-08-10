import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, knowledgeTriples } from '@/shared/db'
import { craftRules } from '@/shared/ai/triples'
import { resetTables } from '../../helpers/reset-db'

// KAG-2 (§5, графовые обходы) на РЕАЛЬНОЙ БД: рекурсивный CTE в craftRules должен
// поднимать не только прямые совпадения (KAG-1), но и СВЯЗАННЫЕ тройки — цепочку
// порядка чтения и предупреждения соседей.

beforeAll(async () => {
  await resetTables(sql`${knowledgeTriples}`)
  await db.insert(knowledgeTriples).values([
    // Цепочка порядка чтения (ru).
    { subject: 'марсианские хроники', relation: 'precedes', object: 'солярис', domain: 'нф', lang: 'ru', confidence: 2 },
    { subject: 'солярис', relation: 'precedes', object: '451 по фаренгейту', domain: 'нф', lang: 'ru', confidence: 1 },
    { subject: '451 по фаренгейту', relation: 'precedes', object: 'дюна', domain: 'нф', lang: 'ru', confidence: 1 },
    { subject: 'дюна', relation: 'precedes', object: 'нейромант', domain: 'нф', lang: 'ru', confidence: 1 },
    // Другой язык — НЕ должен примешаться к ru-обходу.
    { subject: 'dune', relation: 'precedes', object: 'foundation', domain: 'scifi', lang: 'en', confidence: 5 },
    // Несвязанная тройка того же домена — попадёт по домену, но не в цепочку.
    { subject: 'аэлита', relation: 'part-of', object: 'ранняя фантастика', domain: 'нф', lang: 'ru', confidence: 1 },
  ])
})

afterAll(async () => {
  await resetTables(sql`${knowledgeTriples}`)
})

describe('craftRules — KAG-2 графовый обход', () => {
  it('по «солярис» поднимает ВСЮ цепочку (соседи + их соседи), а не только прямое совпадение', async () => {
    const rules = await craftRules('что почитать после соляриса', [], 10)
    const joined = rules.join(' | ')
    // Прямые (depth 0): солярис как object и как subject.
    expect(joined).toContain('марсианские хроники precedes солярис')
    expect(joined).toContain('солярис precedes 451 по фаренгейту')
    // Связанные обходом (depth 1-2): дальше по цепочке.
    expect(joined).toContain('451 по фаренгейту precedes дюна')
    expect(joined).toContain('дюна precedes нейромант')
  })

  it('обход не пересекает язык: ru-цепочка не тянет en-тройку', async () => {
    const rules = await craftRules('дюна', [], 10)
    expect(rules.join(' | ')).not.toContain('foundation')
  })

  it('домен гнома поднимает свои тройки даже без текстового совпадения', async () => {
    const rules = await craftRules('посоветуй книг', ['нф'], 10)
    expect(rules.join(' | ')).toContain('аэлита part-of ранняя фантастика')
  })

  it('подтверждённость показывается (×N) для confidence > 1', async () => {
    const rules = await craftRules('марсианские хроники', [], 10)
    expect(rules.some((r) => r.includes('марсианские хроники precedes солярис') && r.includes('×2'))).toBe(true)
  })
})
