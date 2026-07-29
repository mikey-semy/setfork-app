import { describe, expect, it } from 'vitest'
import { revertPlan } from '@/features/library/suggestion-revert'
import type { ProposedItem } from '@/shared/db'

// Пункт списка в виде, в котором он живёт в версиях: важны blockId и содержимое.
const step = (blockId: string, title: string, desc = ''): ProposedItem =>
  ({ type: 'step', blockId, title, desc }) as unknown as ProposedItem

const idOf = (i: ProposedItem): string => (i as unknown as { blockId: string }).blockId
const titleOf = (i: ProposedItem): string => (i as unknown as { title: string }).title

describe('обратная правка: что правка добавила — убираем', () => {
  it('добавленный пункт исчезает, остальные не трогаются', () => {
    const before = [step('a', 'Первый')]
    const after = [step('a', 'Первый'), step('b', 'Новый')]
    const current = [step('a', 'Первый'), step('b', 'Новый'), step('c', 'Чужой')]
    const plan = revertPlan(before, after, current)
    expect(plan.conflicts).toEqual([])
    expect(plan.items.map((i) => idOf(i))).toEqual(['a', 'c'])
  })

  it('добавленный пункт успели изменить — молча стирать чужую работу нельзя', () => {
    const before = [step('a', 'Первый')]
    const after = [step('a', 'Первый'), step('b', 'Новый')]
    const current = [step('a', 'Первый'), step('b', 'Новый, дописанный')]
    const plan = revertPlan(before, after, current)
    expect(plan.conflicts).toEqual([{ blockId: 'b', title: 'Новый, дописанный', why: 'changed-since' }])
    expect(plan.items).toHaveLength(2) // пункт оставлен на месте — решает человек
  })

  it('добавленный пункт уже убрали без нас — отменять нечего, и это не конфликт', () => {
    const before = [step('a', 'Первый')]
    const after = [step('a', 'Первый'), step('b', 'Новый')]
    const current = [step('a', 'Первый')]
    const plan = revertPlan(before, after, current)
    expect(plan.conflicts).toEqual([])
    expect(plan.items).toHaveLength(1)
  })
})

describe('обратная правка: что правка изменила — возвращаем прежнее', () => {
  it('изменённый пункт получает старое значение', () => {
    const before = [step('a', 'Старый заголовок')]
    const after = [step('a', 'Новый заголовок')]
    const current = [step('a', 'Новый заголовок')]
    const plan = revertPlan(before, after, current)
    expect(plan.conflicts).toEqual([])
    expect(titleOf(plan.items[0])).toBe('Старый заголовок')
  })

  it('поверх легли ещё правки — отменять нечего: неизвестно, что именно', () => {
    const before = [step('a', 'Старый')]
    const after = [step('a', 'Новый')]
    const current = [step('a', 'Ещё новее')]
    const plan = revertPlan(before, after, current)
    expect(plan.conflicts).toEqual([{ blockId: 'a', title: 'Ещё новее', why: 'changed-since' }])
    expect(titleOf(plan.items[0])).toBe('Ещё новее')
  })

  it('изменённый пункт с тех пор удалили — возвращать некуда', () => {
    const before = [step('a', 'Старый'), step('z', 'Другой')]
    const after = [step('a', 'Новый'), step('z', 'Другой')]
    const current = [step('z', 'Другой')]
    const plan = revertPlan(before, after, current)
    expect(plan.conflicts).toEqual([{ blockId: 'a', title: 'Старый', why: 'gone' }])
  })
})

describe('обратная правка: что правка убрала — возвращаем на место', () => {
  it('удалённый пункт встаёт обратно за своим прежним соседом сверху', () => {
    const before = [step('a', 'Первый'), step('b', 'Второй'), step('c', 'Третий')]
    const after = [step('a', 'Первый'), step('c', 'Третий')]
    const current = [step('a', 'Первый'), step('c', 'Третий')]
    const plan = revertPlan(before, after, current)
    expect(plan.items.map((i) => idOf(i))).toEqual(['a', 'b', 'c'])
  })

  it('прежний сосед сам исчез — ищем следующего выше, а не бросаем в конец', () => {
    const before = [step('a', 'Первый'), step('b', 'Второй'), step('c', 'Третий')]
    const after = [step('a', 'Первый'), step('c', 'Третий')]
    const current = [step('a', 'Первый'), step('x', 'Новый чужой')] // 'c' удалили после
    const plan = revertPlan(before, after, current)
    expect(plan.items.map((i) => idOf(i))).toEqual(['a', 'b', 'x'])
  })

  it('удалённый был первым — возвращается в начало', () => {
    const before = [step('a', 'Первый'), step('b', 'Второй')]
    const after = [step('b', 'Второй')]
    const current = [step('b', 'Второй')]
    const plan = revertPlan(before, after, current)
    expect(plan.items.map((i) => idOf(i))).toEqual(['a', 'b'])
  })

  it('пункт уже вернули руками — второй копии не появляется', () => {
    const before = [step('a', 'Первый'), step('b', 'Второй')]
    const after = [step('a', 'Первый')]
    const current = [step('a', 'Первый'), step('b', 'Второй')]
    const plan = revertPlan(before, after, current)
    expect(plan.items.filter((i) => idOf(i) === 'b')).toHaveLength(1)
  })
})

describe('обратная правка: перестановки и чужая работа', () => {
  it('пункты переставили после слияния — откат работает по идентичности, а не по позициям', () => {
    const before = [step('a', 'Первый'), step('b', 'Второй')]
    const after = [step('a', 'Первый изменённый'), step('b', 'Второй')]
    const current = [step('b', 'Второй'), step('a', 'Первый изменённый')] // поменяли местами
    const plan = revertPlan(before, after, current)
    expect(plan.conflicts).toEqual([])
    const byId = Object.fromEntries(plan.items.map((i) => [idOf(i), titleOf(i)]))
    expect(byId.a).toBe('Первый')
    // Порядок, выбранный людьми после слияния, откат не переставляет.
    expect(plan.items.map((i) => idOf(i))).toEqual(['b', 'a'])
  })

  it('пункты без идентичности (списки до ADR-0013) откату не поддаются — и не портятся', () => {
    const noId = { type: 'step', title: 'Без blockId' } as unknown as ProposedItem
    const plan = revertPlan([noId], [noId], [noId])
    expect(plan.conflicts).toEqual([])
    expect(plan.items).toEqual([noId])
  })
})
