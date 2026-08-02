import { describe, expect, it } from 'vitest'
import { deriveCouncilPool, liveModel, priceOf, qualityFloor, workhorses } from '@/shared/ai/model-picker'
import type { ModelOption } from '@/shared/ai/models'

/**
 * Списки моделей в коде убиты: и пул совета, и подмена снятой модели выводятся из живого
 * каталога. Проверяем ПРАВИЛО ВЫВОДА — оно и есть то, что раньше подгнивало в константах
 * (снятая `anthropic/claude-3.5-haiku` в env отвечала 404 при исправном ключе).
 */
const m = (id: string, family: string, price: number, extra: Partial<ModelOption> = {}): ModelOption => ({
  id,
  name: id,
  label: id,
  family,
  priceKnown: price >= 0,
  promptPrice: price,
  completionPrice: price,
  contextLength: 128_000,
  structured: true,
  intelligence: 0,
  ...extra,
})

const CATALOG: ModelOption[] = [
  m('openai/cheap', 'OpenAI', 0.15),
  m('openai/pricey', 'OpenAI', 10),
  m('anthropic/mid', 'Anthropic', 3),
  m('google/cheapest', 'Google', 0.1),
  m('meta/free', 'Meta', 0), // бесплатная: жёсткие лимиты частоты, для совета не годится
  m('mistral/unknown', 'Mistral', -1, { priceKnown: false }), // цену не сказали
  m('x/variable', 'X', -1), // плавающая цена
]

/**
 * Планка качества: без неё живая проверка на каталоге из 336 моделей выдавала в пул
 * ролеплейные файнтюны на 8B — формально самые дешёвые у своих вендоров. Оценку публикует
 * сам каталог, планку берём от распределения этих оценок.
 */
describe('qualityFloor: планка из распределения оценок каталога', () => {
  const rated = [10, 20, 30, 40, 50].map((n, i) => m(`v${i}/m`, `V${i}`, 1, { intelligence: n }))

  it('перцентиль считается по опубликованным оценкам', () => {
    expect(qualityFloor(rated, 0)).toBe(10)
    expect(qualityFloor(rated, 0.5)).toBe(30)
    expect(qualityFloor(rated, 1)).toBe(50)
  })

  it('каталог оценок не публикует → планки нет (а не «все негодные»)', () => {
    expect(qualityFloor(CATALOG, 0.65)).toBe(0)
    expect(workhorses(CATALOG, 0.65).length).toBe(4)
  })

  it('слабые по оценке отсекаются, даже если они самые дешёвые', () => {
    const mixed = [
      m('cheap/dumb', 'Cheap', 0.05, { intelligence: 5 }),
      m('mid/ok', 'Mid', 1, { intelligence: 40 }),
      m('top/smart', 'Top', 5, { intelligence: 50 }),
    ]
    expect(deriveCouncilPool(mixed, 3, 0.5)).toEqual(['mid/ok', 'top/smart'])
  })
})

describe('workhorses: кого вообще можно ставить в работу', () => {
  it('без цены, бесплатные и плавающие — мимо; остальные по цене вверх', () => {
    expect(workhorses(CATALOG).map((x) => x.id)).toEqual(['google/cheapest', 'openai/cheap', 'anthropic/mid', 'openai/pricey'])
  })

  it('провайдер не сообщает про строгий JSON → по этому признаку не отсеиваем', () => {
    const silent = CATALOG.map((x) => ({ ...x, structured: false }))
    expect(workhorses(silent).length).toBe(4)
  })

  it('провайдер сообщает → берём только умеющих', () => {
    const mixed = CATALOG.map((x) => (x.id === 'openai/cheap' ? { ...x, structured: false } : x))
    expect(workhorses(mixed).map((x) => x.id)).not.toContain('openai/cheap')
  })
})

/**
 * Окно контекста: модель, в которую наш промпт физически не влезает, не «дешёвая», а
 * неработающая. Аналог enable_pre_call_checks у LiteLLM — отсев ДО вызова, а не отказ после.
 */
describe('workhorses: окно контекста', () => {
  it('слишком короткий контекст отсеивается, даже если модель самая дешёвая', () => {
    const models = [
      m('tiny/cheap', 'Tiny', 0.05, { contextLength: 4_000 }),
      m('big/ok', 'Big', 1, { contextLength: 128_000 }),
    ]
    expect(workhorses(models, 0.5, 16_000).map((x) => x.id)).toEqual(['big/ok'])
  })

  it('провайдер окно не назвал (0) → не отсеиваем: молчание не равно «не подходит»', () => {
    const models = [m('unknown/ctx', 'U', 1, { contextLength: 0 })]
    expect(workhorses(models, 0.5, 16_000).map((x) => x.id)).toEqual(['unknown/ctx'])
  })
})

describe('deriveCouncilPool: пул из каталога, а не из списка в коде', () => {
  it('по одной самой дешёвой модели от вендора, дешёвая первой (она ведёт промежуточные шаги)', () => {
    expect(deriveCouncilPool(CATALOG, 3)).toEqual(['google/cheapest', 'openai/cheap', 'anthropic/mid'])
  })

  it('вендоры не дублируются — совет заводился ради РАЗНЫХ мнений', () => {
    const pool = deriveCouncilPool(CATALOG, 5)
    expect(pool).not.toContain('openai/pricey')
  })

  it('пустой каталог → пустой пул (вызывающий откатится на проверенную основную модель)', () => {
    expect(deriveCouncilPool([], 3)).toEqual([])
  })
})

describe('liveModel: назначенная модель сверяется с каталогом', () => {
  it('модель в каталоге есть — не трогаем выбор владельца', () => {
    expect(liveModel(CATALOG, 'anthropic/mid')).toBe('anthropic/mid')
  })

  it('модель снята с обслуживания → замена из каталога, а не 404', () => {
    expect(liveModel(CATALOG, 'anthropic/claude-3.5-haiku')).toBe('google/cheapest')
  })

  it('каталога нет (нет ключа, сеть, гео-блок) → выбор владельца остаётся как есть', () => {
    expect(liveModel([], 'anthropic/claude-3.5-haiku')).toBe('anthropic/claude-3.5-haiku')
  })
})

describe('priceOf: сравниваем по цене выхода', () => {
  it('неизвестная и плавающая уходят в хвост', () => {
    expect(priceOf(m('a/b', 'A', -1, { priceKnown: false }))).toBe(Number.POSITIVE_INFINITY)
    expect(priceOf(m('a/c', 'A', -1))).toBe(Number.POSITIVE_INFINITY)
    expect(priceOf(m('a/d', 'A', 2))).toBe(2)
  })
})
