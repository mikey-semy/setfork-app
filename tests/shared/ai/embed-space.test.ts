import { describe, expect, it } from 'vitest'
import {
  COLUMN_DIM,
  EMBED_TARGET_SETTING,
  fitToColumn,
  parseIndexSpace,
  resolveTargetSpace,
  sameSpace,
  YANDEX_EMBED_DIM,
} from '@/shared/ai/embed-space'

describe('resolveTargetSpace', () => {
  it('дефолт — openrouter, одна модель на doc/query, колоночная мерность', () => {
    const s = resolveTargetSpace({}, {})
    expect(s.provider).toBe('openrouter')
    expect(s.docModel).toBe(s.queryModel)
    expect(s.dim).toBe(COLUMN_DIM)
  })

  it('yandex: пара doc/query-моделей с folder_id и 768-мерность', () => {
    const s = resolveTargetSpace({ [EMBED_TARGET_SETTING]: 'yandex', 'ai.yandex_folder_id': 'b1gx' }, {})
    expect(s).toMatchObject({
      provider: 'yandex',
      docModel: 'emb://b1gx/text-embeddings-v2-doc/latest',
      queryModel: 'emb://b1gx/text-embeddings-v2-query/latest',
      dim: YANDEX_EMBED_DIM,
    })
  })

  it('env EMBED_PROVIDER работает как фолбэк, folder из env', () => {
    const s = resolveTargetSpace({}, { EMBED_PROVIDER: 'yandex', YC_AI_FOLDER_ID: 'b1genv' })
    expect(s.docModel).toContain('b1genv')
  })
})

describe('parseIndexSpace', () => {
  it('валидный JSON разбирается, мусор и пусто — null (легаси)', () => {
    const raw = JSON.stringify({ provider: 'yandex', docModel: 'd', queryModel: 'q', dim: 768, at: 1 })
    expect(parseIndexSpace(raw)).toMatchObject({ provider: 'yandex', dim: 768 })
    expect(parseIndexSpace('{broken')).toBeNull()
    expect(parseIndexSpace('')).toBeNull()
    expect(parseIndexSpace(JSON.stringify({ provider: 'x', docModel: 'd', queryModel: 'q', dim: 1 }))).toBeNull()
  })
})

describe('fitToColumn', () => {
  it('короче колонки → паддинг нулями; ровно — не трогаем', () => {
    const v = fitToColumn(new Array<number>(256).fill(0.5))
    expect(v).toHaveLength(COLUMN_DIM)
    expect(v[255]).toBe(0.5)
    expect(v[256]).toBe(0)
    expect(fitToColumn(new Array<number>(COLUMN_DIM).fill(1))).toHaveLength(COLUMN_DIM)
  })

  it('длиннее колонки (не-MRL без dimensions) → усечение + L2-нормализация', () => {
    const v = fitToColumn(new Array<number>(COLUMN_DIM + 64).fill(2))
    expect(v).toHaveLength(COLUMN_DIM)
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
    expect(norm).toBeCloseTo(1, 9)
  })

  it('паддинг не меняет косинусную близость', () => {
    const a = [1, 2, 3]
    const b = [2, 1, 0]
    const cos = (x: number[], y: number[]) => {
      const dot = x.reduce((s, v, i) => s + v * y[i], 0)
      const n = (v: number[]) => Math.sqrt(v.reduce((s, u) => s + u * u, 0))
      return dot / (n(x) * n(y))
    }
    const pad = (v: number[]) => [...v, 0, 0, 0]
    expect(cos(pad(a), pad(b))).toBeCloseTo(cos(a, b), 12)
  })
})

describe('sameSpace', () => {
  const s = { provider: 'yandex' as const, docModel: 'd', queryModel: 'q', dim: 768 }
  it('сравнивает провайдера, doc-модель и мерность', () => {
    expect(sameSpace(s, { ...s })).toBe(true)
    expect(sameSpace(s, { ...s, dim: 256 })).toBe(false)
    expect(sameSpace(s, { ...s, provider: 'openrouter' })).toBe(false)
  })
})
