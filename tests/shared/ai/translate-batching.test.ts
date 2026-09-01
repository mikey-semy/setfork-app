import { describe, expect, it } from 'vitest'
import { batchByChars } from '@/shared/ai/generate'

/**
 * Врезки — самое длинное, что есть у списка. Раньше сериализованный JSON просто
 * обрезался по лимиту промпта: модель видела оборванный кусок и не видела
 * последних, а ответ требовался на каждый — то есть длинный список не
 * переводился бы никогда, сколько ни жми кнопку.
 */

describe('batchByChars', () => {
  it('всё, что влезает, идёт одной партией', () => {
    expect(batchByChars(['раз', 'два', 'три'], 100)).toEqual([['раз', 'два', 'три']])
  })

  it('пустой вход — пустой список партий', () => {
    expect(batchByChars([], 100)).toEqual([])
  })

  it('режет по границе, не теряя кусков', () => {
    const chunks = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)]
    const batches = batchByChars(chunks, 100)

    expect(batches?.flat()).toEqual(chunks)
    expect(batches?.length).toBe(2)
  })

  it('порядок кусков сохраняется — на нём держится сборка обратно', () => {
    const chunks = Array.from({ length: 20 }, (_, i) => `${i}`.repeat(30))
    expect(batchByChars(chunks, 100)?.flat()).toEqual(chunks)
  })

  /** Обрезанный перевод хуже отсутствующего: он выглядит целым. */
  it('кусок, не влезающий в одиночку, — отказ целиком', () => {
    expect(batchByChars(['ok', 'x'.repeat(200)], 100)).toBeNull()
  })

  it('кусок ровно по лимиту с запасом на кавычки не проходит', () => {
    expect(batchByChars(['x'.repeat(100)], 100)).toBeNull()
    expect(batchByChars(['x'.repeat(96)], 100)).toEqual([['x'.repeat(96)]])
  })
})
