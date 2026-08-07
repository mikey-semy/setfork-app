import { describe, expect, it } from 'vitest'
import { dropTargetIndex, insertBlock, moveBlock, patchBlock, removeBlock, reorderBlocks, retypeBlock, type Snapshot } from '@/features/library/list-editor/block-ops'
import { emptyItem, type EditorItem } from '@/features/library/editor'

/**
 * ПУНКТЫ И ИХ ID ДВИГАЮТСЯ ПАРАМИ.
 *
 * У каждой строки редактора есть стабильный id: по нему React отличает карточки, а
 * анимация перестановки понимает, кто куда переехал. Стоит хоть одной операции
 * сдвинуть пункты и не сдвинуть id — и карточки поедут не те, а отмена восстановит
 * чужой порядок. Раньше эти перестановки жили внутри компонента и проверялись
 * только глазами.
 */
const snapOf = (titles: string[]): Snapshot => ({
  items: titles.map((title) => ({ ...emptyItem(), title }) as EditorItem),
  uids: titles.map((_, i) => 'r' + i),
})
const titlesOf = (s: Snapshot) => s.items.map((i) => i.title)

describe('операции над составом списка', () => {
  it('вставка кладёт блок на место и выдаёт ему свой id', () => {
    const next = insertBlock(snapOf(['a', 'b']), 1, 'text', 'r9')
    expect(titlesOf(next)).toEqual(['a', '', 'b'])
    expect(next.uids).toEqual(['r0', 'r9', 'r1'])
    expect(next.items[1].type).toBe('text')
  })

  it('вставка за пределами списка прижимается к краю, а не рвёт порядок', () => {
    expect(insertBlock(snapOf(['a']), 99, 'step', 'r9').uids).toEqual(['r0', 'r9'])
    expect(insertBlock(snapOf(['a']), -5, 'step', 'r9').uids).toEqual(['r9', 'r0'])
  })

  it('удаление убирает пункт вместе с его id', () => {
    const next = removeBlock(snapOf(['a', 'b', 'c']), 1)
    expect(titlesOf(next)).toEqual(['a', 'c'])
    expect(next.uids).toEqual(['r0', 'r2'])
  })

  it('последний блок не удаляется: пустой редактор нечем показать', () => {
    const one = snapOf(['a'])
    expect(removeBlock(one, 0)).toBe(one)
  })

  it('сдвиг меняет местами и пункты, и id', () => {
    const next = moveBlock(snapOf(['a', 'b', 'c']), 0, 1)
    expect(titlesOf(next)).toEqual(['b', 'a', 'c'])
    expect(next.uids).toEqual(['r1', 'r0', 'r2'])
  })

  it('сдвиг за край списка ничего не делает', () => {
    const s = snapOf(['a', 'b'])
    expect(moveBlock(s, 0, -1)).toBe(s)
    expect(moveBlock(s, 1, 1)).toBe(s)
  })

  it('перенос на произвольную позицию сохраняет пары «пункт — id»', () => {
    const next = reorderBlocks(snapOf(['a', 'b', 'c', 'd']), 3, 1)
    expect(titlesOf(next)).toEqual(['a', 'd', 'b', 'c'])
    expect(next.uids).toEqual(['r0', 'r3', 'r1', 'r2'])
  })

  it('перенос в никуда и на себя не трогает состав', () => {
    const s = snapOf(['a', 'b'])
    expect(reorderBlocks(s, 1, 1)).toBe(s)
    expect(reorderBlocks(s, 0, 5)).toBe(s)
    expect(reorderBlocks(s, -1, 0)).toBe(s)
  })

  it('бросок у кромки карточки попадает туда, где показана линия', () => {
    // [a,b,c,d]: тащим a вниз и бросаем над c — встать должен ровно перед c.
    const s = snapOf(['a', 'b', 'c', 'd'])
    expect(titlesOf(reorderBlocks(s, 0, dropTargetIndex(0, 2, 'before')))).toEqual(['b', 'a', 'c', 'd'])
    expect(titlesOf(reorderBlocks(s, 0, dropTargetIndex(0, 2, 'after')))).toEqual(['b', 'c', 'a', 'd'])
    // Вверх поправка на изъятие не нужна — цели выше не съезжают.
    expect(titlesOf(reorderBlocks(s, 3, dropTargetIndex(3, 1, 'before')))).toEqual(['a', 'd', 'b', 'c'])
    expect(titlesOf(reorderBlocks(s, 3, dropTargetIndex(3, 1, 'after')))).toEqual(['a', 'b', 'd', 'c'])
  })

  it('бросок на своё же место ничего не меняет', () => {
    const s = snapOf(['a', 'b', 'c'])
    expect(titlesOf(reorderBlocks(s, 1, dropTargetIndex(1, 1, 'before')))).toEqual(['a', 'b', 'c'])
    expect(titlesOf(reorderBlocks(s, 1, dropTargetIndex(1, 1, 'after')))).toEqual(['a', 'b', 'c'])
  })

  it('смена типа оставляет блок на месте и сохраняет его id', () => {
    // Выбор в слэш-меню: блок был текстовым, стал опросом — но это тот же блок,
    // и анимация не должна показывать переезд.
    const s = snapOf(['a', 'b'])
    const next = retypeBlock(s, 1, 'poll')
    expect(next.items[1].type).toBe('poll')
    expect(next.items[1].title).toBe('')
    expect(next.uids).toEqual(s.uids)
    expect(next.items[0]).toBe(s.items[0])
  })

  it('смена типа на тот же и за пределами списка ничего не делает', () => {
    const s = snapOf(['a'])
    expect(retypeBlock(s, 0, s.items[0].type)).toBe(s)
    expect(retypeBlock(s, 5, 'text')).toBe(s)
  })

  it('правка полей меняет только свой пункт и не трогает id', () => {
    const s = snapOf(['a', 'b'])
    const next = patchBlock(s, 1, { title: 'правка' })
    expect(titlesOf(next)).toEqual(['a', 'правка'])
    expect(next.uids).toBe(s.uids)
    expect(next.items[0]).toBe(s.items[0])
  })
})
