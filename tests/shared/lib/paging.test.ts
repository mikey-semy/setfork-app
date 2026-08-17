import { describe, expect, it } from 'vitest'
import { feedWindow, LISTS_PER_PAGE, pageCount, pageFromParam, pageWindow } from '@/shared/lib/paging'

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

// Битое окно обязано падать, а не «показывать всё». Драйвер молча выбрасывает предел,
// который не число, — так главная и отдавала все 518 списков при внешне верном коде.
describe('проверка окна перед запросом', () => {
  it('пропускает целое положительное окно как есть', () => {
    expect(feedWindow({ limit: 7 })).toEqual({ limit: 7, offset: 0 })
    expect(feedWindow({ limit: 7, offset: 14 })).toEqual({ limit: 7, offset: 14 })
  })

  it('падает на пределе, который не число', () => {
    // Именно этот случай и был живым: через границу RSC константа приезжала функцией.
    expect(() => feedWindow({ limit: (() => 7) as unknown as number })).toThrow(/limit/)
    expect(() => feedWindow({ limit: undefined as unknown as number })).toThrow(/limit/)
    expect(() => feedWindow({ limit: '7' as unknown as number })).toThrow(/limit/)
  })

  it('падает на пустом и дробном пределе, а не режет молча', () => {
    expect(() => feedWindow({ limit: 0 })).toThrow(/limit/)
    expect(() => feedWindow({ limit: -1 })).toThrow(/limit/)
    expect(() => feedWindow({ limit: 7.5 })).toThrow(/limit/)
  })

  it('падает на битом смещении', () => {
    expect(() => feedWindow({ limit: 7, offset: -1 })).toThrow(/offset/)
    expect(() => feedWindow({ limit: 7, offset: NaN })).toThrow(/offset/)
  })

  it('не трогает само значение, сообщая о нём — иначе ошибка подменится чужой', () => {
    // Ссылка на клиентский модуль бросает на любом обращении, включая valueOf.
    const hostile = new Proxy(() => {}, {
      get: () => {
        throw new Error('Cannot access on the server')
      },
    }) as unknown as number
    expect(() => feedWindow({ limit: hostile })).toThrow(TypeError)
  })
})
