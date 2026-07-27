import { describe, expect, it } from 'vitest'
import { contribution, facetsOfDraft, facetsOfFinal, keys, share } from '@/shared/ai/facets'
import type { CandidateItem } from '@/shared/db'

// Метрика многогранности на ПРИДУМАННЫХ данных: иначе «замер» проверяет сам себя своими же
// числами, и в отчёт можно поверить зря. Здесь важно ровно одно свойство — метрика считает
// РАЗНЫЕ УГЛЫ ЗРЕНИЯ, а не разные формулировки одного и того же.

const item = (title: string): CandidateItem => ({ title, desc: '', command: '', subtasks: [] })

describe('нормализация', () => {
  it('стоп-слова и короткие слова выбрасываются', () => {
    expect(keys('Проверить это в базе на всё')).not.toContain('это')
    expect(keys('Check the backup of your DB')).not.toContain('the')
  })

  it('формы одного слова сводятся: бэкапы ≈ бэкап, checks ≈ check', () => {
    const a = keys('проверить бэкапы')
    const b = keys('проверьте бэкап')
    expect(a.filter((w) => b.includes(w)).length).toBeGreaterThan(0)
  })
})

describe('грани черновика', () => {
  it('пункты берём, прозу — нет', () => {
    const f = facetsOfDraft(`Вот мой черновик списка, я подумал о разном и решил начать с простого.
1. Проверить бэкапы базы
- Настроить мониторинг диска
• Прогнать миграции на копии`)
    expect(f.size).toBe(3)
  })

  it('короткий мусор не становится гранью', () => {
    expect(facetsOfDraft('1. ок\n- да\n\n').size).toBe(0)
  })
})

describe('одна грань или две', () => {
  it('разные формулировки одного угла — одна грань', () => {
    const mine = facetsOfDraft('1. Проверить бэкапы базы данных')
    const others = facetsOfDraft('1. Проверьте бэкап базы')
    expect(share([...mine][0], others)).toBe(true)
  })

  it('разные углы — не совпадают', () => {
    const mine = facetsOfDraft('1. Проверить бэкапы базы')
    const others = facetsOfDraft('1. Настроить алерты в телеграм')
    expect(share([...mine][0], others)).toBe(false)
  })
})

describe('вклад участника (leave-one-out)', () => {
  const mine = facetsOfDraft(`1. Проверить бэкапы базы
2. Настроить алерты диска
3. Сменить ключи доступа`)
  const others = facetsOfDraft(`1. Проверьте бэкап базы
2. Настройте алерт по диску`)

  it('уникальна только та грань, которой нет у других', () => {
    const c = contribution(mine, others, new Set())
    expect(c.all).toHaveLength(3)
    expect(c.unique).toHaveLength(1) // «сменить ключи доступа»
  })

  it('доехавшей считается уникальная грань, попавшая в финал', () => {
    const final = facetsOfFinal([item('Проверить бэкапы базы'), item('Ротация ключей доступа')])
    expect(contribution(mine, others, final).delivered).toHaveLength(1)
  })

  it('синтез выбросил уникальное → доехало ноль (это и есть схлопывание разнообразия)', () => {
    const final = facetsOfFinal([item('Проверить бэкапы базы'), item('Настроить алерты диска')])
    const c = contribution(mine, others, final)
    expect(c.unique).toHaveLength(1)
    expect(c.delivered).toHaveLength(0)
  })

  it('участник без своих граней даёт пустой вклад — совет из клонов виден сразу', () => {
    const c = contribution(others, mine, facetsOfFinal([item('Проверить бэкапы базы')]))
    expect(c.unique).toEqual([])
  })
})
