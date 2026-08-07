import { describe, expect, it } from 'vitest'
import { edgeScrollStep, movedEnough, targetAt, type Band } from '@/features/library/list-editor/drag-geometry'

/**
 * ПЕРЕНОС ПАЛЬЦЕМ ПОПАДАЕТ ТУДА, ГДЕ ПОКАЗАНА ЛИНИЯ.
 *
 * Раньше цель определял браузер: карточка сама ловила dragover и решала, что курсор
 * над ней. С Pointer Events цель считаем мы — по полосам карточек и координате
 * указателя, — и ошибка здесь выглядит как «линия показывала одно, блок встал в
 * другое». Поэтому арифметика вынесена из хука и проверяется без браузера.
 *
 * Полосы заданы в координатах документа: страница под пальцем скроллится, а
 * документные координаты от этого не сдвигаются.
 */
const bands: Band[] = [
  { top: 0, bottom: 100 },
  { top: 110, bottom: 210 },
  { top: 220, bottom: 320 },
]

describe('геометрия переноса карточек', () => {
  it('верхняя половина карточки целится перед ней, нижняя — после', () => {
    expect(targetAt(bands, 130)).toEqual({ over: 1, side: 'before' })
    expect(targetAt(bands, 200)).toEqual({ over: 1, side: 'after' })
  })

  it('ровно на середине карточки блок встаёт под неё', () => {
    expect(targetAt(bands, 160)).toEqual({ over: 1, side: 'after' })
  })

  it('за пределами списка целью становится его край', () => {
    // Иначе перенос в самое начало требовал бы попасть точно в первую карточку.
    expect(targetAt(bands, -40)).toEqual({ over: 0, side: 'before' })
    expect(targetAt(bands, 999)).toEqual({ over: 2, side: 'after' })
  })

  it('в зазоре между карточками цель — под верхней из них', () => {
    expect(targetAt(bands, 105)).toEqual({ over: 0, side: 'after' })
    expect(targetAt(bands, 215)).toEqual({ over: 1, side: 'after' })
  })

  it('без карточек целиться некуда', () => {
    expect(targetAt([], 50)).toBeNull()
  })

  it('дрожание пальца при касании — ещё не перенос', () => {
    expect(movedEnough(100, 100, 103, 102)).toBe(false)
    expect(movedEnough(100, 100, 100, 112)).toBe(true)
  })

  it('в середине экрана страница стоит, у краёв едет в свою сторону', () => {
    expect(edgeScrollStep(400, 844)).toBe(0)
    expect(edgeScrollStep(10, 844)).toBeLessThan(0)
    expect(edgeScrollStep(838, 844)).toBeGreaterThan(0)
  })

  it('чем ближе к краю, тем быстрее, но не быстрее предела', () => {
    const near = edgeScrollStep(4, 844)
    const far = edgeScrollStep(60, 844)
    expect(Math.abs(near)).toBeGreaterThan(Math.abs(far))
    // Палец, уехавший за край окна, не разгоняет прокрутку сверх той, что у самого края.
    expect(edgeScrollStep(-500, 844)).toBe(edgeScrollStep(0, 844))
  })
})
