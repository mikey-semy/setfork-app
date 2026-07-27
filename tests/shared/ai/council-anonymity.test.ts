import { describe, expect, it } from 'vitest'
import { anonymizeDrafts, draftLetter } from '@/shared/ai/council'
import { pickPrecedentsDetailed } from '@/shared/ai/precedent-filter'

// ИНВАРИАНТ АНОНИМНОСТИ. Критик и старейшина не должны видеть, кто написал черновик: как
// только оценщик знает автора, оценка плывёт к его репутации, а маршрутизация начинает
// выбирать худших (provenance paradox, arXiv 2603.18043). Это свойство легко потерять при
// следующей правке промпта — поэтому оно проверяется тестом, а не внимательностью.

const drafts = [
  { who: 'coder', text: '1. Настроить CI\n2. Прогнать тесты' },
  { who: 'cook', text: '1. Замесить тесто\n2. Испечь' },
  { who: 'innovator', text: 'Смелая идея: собрать всё в одном месте' },
]

describe('анонимный блок черновиков', () => {
  it('подписан ТОЛЬКО буквами — ни одного автора в тексте', () => {
    const block = anonymizeDrafts(drafts)
    for (const d of drafts) expect(block).not.toContain(d.who)
    expect(block).toContain('--- DRAFT A ---')
    expect(block).toContain('--- DRAFT B ---')
    expect(block).toContain('--- DRAFT C ---')
  })

  it('содержимое черновиков передаётся целиком и по порядку', () => {
    const block = anonymizeDrafts(drafts)
    expect(block.indexOf('Настроить CI')).toBeLessThan(block.indexOf('Замесить тесто'))
    expect(block).toContain('Смелая идея: собрать всё в одном месте')
  })

  it('шаги с фигурными скобками не режутся (черновик — свободный текст, не JSON)', () => {
    const block = anonymizeDrafts([{ text: "1. awk '{print $1}'\n2. cd ${HOME}/bin" }])
    expect(block).toContain("awk '{print $1}'")
    expect(block).toContain('${HOME}/bin')
  })

  it('буквы идут A, B, C… — по ним строится карта авторства', () => {
    expect([0, 1, 2, 25].map(draftLetter)).toEqual(['A', 'B', 'C', 'Z'])
  })

  it('пустой набор — пустой блок, а не «--- DRAFT ---» без содержимого', () => {
    expect(anonymizeDrafts([])).toBe('')
  })
})

describe('пробел опоры (noBasis) виден структурно', () => {
  const lists = [
    { title: 'Борщ', tags: ['кулинария'] },
    { title: 'Деплой', tags: ['deploy'] },
  ]

  it('по домену нашлось — matched, и это НЕ пробел', () => {
    const got = pickPrecedentsDetailed(lists, ['кулинария'])
    expect(got.matched).toBe(true)
    expect(got.items[0].title).toBe('Борщ')
  })

  it('по домену не нашлось — фолбэк отдаёт общие, но matched=false', () => {
    const got = pickPrecedentsDetailed(lists, ['юриспруденция'])
    expect(got.matched).toBe(false)
    expect(got.items.length).toBeGreaterThan(0) // промпт не пустой — фолбэк работает
  })

  it('прецедентов нет вообще — ни опоры, ни фолбэка', () => {
    expect(pickPrecedentsDetailed([], ['кулинария'])).toEqual({ items: [], matched: false })
  })

  it('универсал «*» опирается на всё, что есть; на пустом — тоже пробел', () => {
    expect(pickPrecedentsDetailed(lists, ['*']).matched).toBe(true)
    expect(pickPrecedentsDetailed([], ['*']).matched).toBe(false)
  })
})
