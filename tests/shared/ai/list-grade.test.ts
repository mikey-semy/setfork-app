import { describe, expect, it } from 'vitest'
import { featuresOf, gradeList, gradeRank, type GradeFeatures } from '@/shared/ai/list-grade'

// Класс полноты — градуированная замена «годно / не годно». Тесты держат три свойства:
// класс = САМЫЙ ВЫСОКИЙ выполненный (а не «сколько галочек набрал»), причина всегда приходит
// вместе с классом (иначе петле нечего улучшать), и пометки «нужен человек» класс НЕ понижают.

const f = (over: Partial<GradeFeatures> = {}): GradeFeatures => ({
  steps: 10,
  withDesc: 10,
  withWhy: 10,
  refs: 3,
  deadLinks: 0,
  sections: true,
  needsHuman: 0,
  ...over,
})

describe('лестница классов', () => {
  it('пустой список — stub', () => {
    expect(gradeList(f({ steps: 0, withDesc: 0, withWhy: 0, refs: 0 })).grade).toBe('stub')
  })

  it('три шага без описаний — stub', () => {
    expect(gradeList(f({ steps: 3, withDesc: 0, withWhy: 0, refs: 0 })).grade).toBe('stub')
  })

  it('четыре шага, половина с описанием — start', () => {
    expect(gradeList(f({ steps: 4, withDesc: 2, withWhy: 0, refs: 0 })).grade).toBe('start')
  })

  it('шесть шагов, описания у 70%, один источник — solid', () => {
    expect(gradeList(f({ steps: 6, withDesc: 5, withWhy: 0, refs: 1, sections: false })).grade).toBe('solid')
  })

  it('полный набор — full', () => {
    expect(gradeList(f()).grade).toBe('full')
  })

  it('порядок классов сравним с планкой', () => {
    expect(gradeRank('stub')).toBeLessThan(gradeRank('start'))
    expect(gradeRank('solid')).toBeLessThan(gradeRank('full'))
  })
})

describe('причина приходит вместе с классом', () => {
  it('до full не хватило источников — так и написано', () => {
    const v = gradeList(f({ refs: 1 }))
    expect(v.grade).toBe('solid')
    expect(v.next.join(' ')).toContain('источников меньше двух')
  })

  it('мёртвая ссылка не даёт подняться выше start', () => {
    const v = gradeList(f({ deadLinks: 1 }))
    expect(v.grade).toBe('start')
    expect(v.next.join(' ')).toContain('мёртвых ссылок: 1')
  })

  it('длинный список без секций до full не дотягивает', () => {
    const v = gradeList(f({ sections: false }))
    expect(v.grade).toBe('solid')
    expect(v.next.join(' ')).toContain('без секций')
  })

  it('короткому списку секции не нужны — это не претензия', () => {
    const v = gradeList(f({ steps: 8, withDesc: 8, withWhy: 8, refs: 2, sections: false }))
    expect(v.grade).toBe('full')
    expect(v.next).toEqual([])
  })
})

describe('пометки «нужен человек»', () => {
  it('класс не понижают: честность лучше выдуманной цифры', () => {
    expect(gradeList(f({ needsHuman: 4 })).grade).toBe('full')
  })

  it('но видны в причинах — это часть портрета списка', () => {
    expect(gradeList(f({ needsHuman: 2 })).reasons.join(' ')).toContain('нужен человек')
  })
})

describe('признаки из пунктов', () => {
  it('считает описания, «зачем», уникальные ссылки, секции и пометки', () => {
    const got = featuresOf([
      { desc: 'раз', why: 'потому', refs: [{ url: 'https://a' }, { url: 'https://a' }], section: 'Подготовка' },
      { desc: '  ', refs: [{ url: 'https://b' }], needsHuman: true },
      {},
    ])
    expect(got).toMatchObject({ steps: 3, withDesc: 1, withWhy: 1, refs: 2, sections: true, needsHuman: 1 })
  })

  it('мёртвые ссылки приходят снаружи — их считает проверка ссылок, а не грейдер', () => {
    expect(featuresOf([{ desc: 'x' }], 3).deadLinks).toBe(3)
  })

  it('пустой список даёт нулевые признаки, а не деление на ноль', () => {
    expect(featuresOf([])).toMatchObject({ steps: 0, withDesc: 0, refs: 0 })
    expect(gradeList(featuresOf([])).grade).toBe('stub')
  })
})
