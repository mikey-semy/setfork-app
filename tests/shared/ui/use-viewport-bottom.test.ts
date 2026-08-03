import { describe, expect, it } from 'vitest'
import { clampedBottom, viewportBottomGap } from '@/shared/ui/use-viewport-bottom'

describe('viewportBottomGap', () => {
  it('вьюпорты совпадают — поправки нет', () => {
    expect(viewportBottomGap({ innerHeight: 844, visualHeight: 844, visualOffsetTop: 0 })).toBe(0)
  })

  it('layout-низ скрыт ниже видимой области — поправка равна скрытому куску', () => {
    // Ровно жалоба владельца: страница «думает», что она 3212, видно 844 → кнопка
    // без поправки сидит на 2368px ниже экрана, то есть визуально в середине.
    expect(viewportBottomGap({ innerHeight: 3212, visualHeight: 844, visualOffsetTop: 0 })).toBe(2368)
  })

  it('клавиатура ресайзит контент — поправки нет, элемент и так над клавиатурой', () => {
    expect(viewportBottomGap({ innerHeight: 560, visualHeight: 560, visualOffsetTop: 0 })).toBe(0)
  })

  it('страница отжата вниз (visual сдвинут) — учитываем смещение', () => {
    expect(viewportBottomGap({ innerHeight: 844, visualHeight: 600, visualOffsetTop: 100 })).toBe(144)
  })

  it('visual больше layout (свернулась панель браузера) — не уходим в минус', () => {
    expect(viewportBottomGap({ innerHeight: 800, visualHeight: 844, visualOffsetTop: 0 })).toBe(0)
  })
})

describe('clampedBottom', () => {
  it('места хватает — поднимаем ровно на запрошенное', () => {
    expect(clampedBottom({ desired: 100, visibleHeight: 844, selfSize: 40 })).toBe(100)
  })

  it('высокая панель чата — кнопка не улетает за верх экрана', () => {
    // Чат до 70% высоты: подъём 610 оставил бы кнопку выше кромки — режем до потолка.
    expect(clampedBottom({ desired: 610, visibleHeight: 600, selfSize: 40 })).toBe(544)
  })

  it('крошечная видимая область — остаётся хотя бы отступ', () => {
    expect(clampedBottom({ desired: 400, visibleHeight: 40, selfSize: 40 })).toBe(16)
  })
})
