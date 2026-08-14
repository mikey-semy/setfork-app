import { describe, expect, it } from 'vitest'
import { LISTS_PER_PAGE, pageCount, pageFromParam, pageWindow } from '@/shared/lib/paging'

// Арифметика страниц выглядит очевидной ровно до первой ошибки в ней: смещение на единицу
// тихо теряет двадцатый список или показывает его дважды, и заметить это можно только
// пересчитав выдачу руками. Поэтому она живёт в одном месте и проверяется здесь.

describe('окно запроса', () => {
  it('первая страница начинается с нуля', () => {
    expect(pageWindow(1)).toEqual({ limit: LISTS_PER_PAGE, offset: 0 })
  })

  it('вторая продолжает первую без зазора и без нахлёста', () => {
    expect(pageWindow(2)).toEqual({ limit: LISTS_PER_PAGE, offset: LISTS_PER_PAGE })
  })

  it('мусор в номере страницы читается как первая', () => {
    // Номер приходит из адреса, то есть от кого угодно.
    expect(pageWindow(0).offset).toBe(0)
    expect(pageWindow(-5).offset).toBe(0)
    expect(pageWindow(NaN).offset).toBe(0)
    expect(pageWindow(2.7).offset).toBe(LISTS_PER_PAGE)
  })
})

describe('число страниц', () => {
  it('ровное деление не даёт лишней пустой страницы', () => {
    expect(pageCount(LISTS_PER_PAGE)).toBe(1)
    expect(pageCount(LISTS_PER_PAGE * 2)).toBe(2)
  })

  it('остаток занимает свою страницу', () => {
    expect(pageCount(LISTS_PER_PAGE + 1)).toBe(2)
  })

  it('пустая выдача — это одна страница, а не ноль', () => {
    // Ноль страниц означал бы, что показывать нечего даже пустое состояние.
    expect(pageCount(0)).toBe(1)
  })
})

describe('номер страницы из адреса', () => {
  it('за краем приводится к последней существующей', () => {
    expect(pageFromParam('99', 3)).toBe(3)
  })

  it('мусор и отсутствие — первая', () => {
    expect(pageFromParam(undefined, 3)).toBe(1)
    expect(pageFromParam('-2', 3)).toBe(1)
    expect(pageFromParam('пятая', 3)).toBe(1)
  })
})
