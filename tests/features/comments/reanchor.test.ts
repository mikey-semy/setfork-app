import { describe, it, expect } from 'vitest'
import { makeAnchor } from '@/features/comments/anchor'
import { reanchorThread, type ThreadAnchorState } from '@/features/comments/reanchor'
import type { AnchorableBlock } from '@/features/comments/fields'

const DESC = 'Залей желатин 100 мл холодной воды и оставь набухать на 15 минут.'

const block = (over: Partial<AnchorableBlock> = {}): AnchorableBlock => ({
  blockId: 'b1',
  type: 'step',
  title: { ru: 'Замочить желатин' },
  desc: { ru: DESC },
  ...over,
})

const thread = (over: Partial<ThreadAnchorState> = {}): ThreadAnchorState => {
  const i = DESC.indexOf('холодной воды')
  return {
    blockId: 'b1',
    field: 'desc',
    anchorOriginal: makeAnchor(DESC, i, i + 'холодной воды'.length),
    anchorCurrent: null,
    anchorState: 'anchored',
    anchorConfidence: null,
    anchorChangedAt: null,
    ...over,
  }
}

describe('reanchorThread', () => {
  it('блок исчез из версии → осиротел, с версией потери', () => {
    const up = reanchorThread(thread(), [block({ blockId: 'other' })], 7, 'ru')
    expect(up?.anchorState).toBe('orphaned')
    expect(up?.anchorChangedAt).toBe(7)
  })

  it('повторный прогон по осиротевшему треду ничего не переписывает', () => {
    const t = thread({ anchorState: 'orphaned', anchorChangedAt: 7 })
    expect(reanchorThread(t, [block({ blockId: 'other' })], 9, 'ru')).toBeNull()
  })

  it('блок на месте, текст не менялся → якорь привязан', () => {
    const up = reanchorThread(thread(), [block()], 2, 'ru')
    expect(up?.anchorState).toBe('anchored')
    expect(up?.anchorConfidence).toBe(100)
    expect(up?.anchorCurrent?.exact).toBe('холодной воды')
  })

  it('текст сдвинули вставкой выше → якорь едет за цитатой', () => {
    const moved = 'Сначала достань миску. ' + DESC
    const up = reanchorThread(thread(), [block({ desc: { ru: moved } })], 3, 'ru')
    expect(up?.anchorState).toBe('anchored')
    expect(moved.slice(up!.anchorCurrent!.start, up!.anchorCurrent!.end)).toBe('холодной воды')
  })

  it('поле опустошили → осиротел, а не привязался наугад', () => {
    const up = reanchorThread(thread(), [block({ desc: { ru: '' } })], 4, 'ru')
    expect(up?.anchorState).toBe('orphaned')
    expect(up?.anchorChangedAt).toBe(4)
  })

  it('текст переписали целиком → осиротел', () => {
    const up = reanchorThread(thread(), [block({ desc: { ru: 'Разогрей духовку до 180 градусов.' } })], 5, 'ru')
    expect(up?.anchorState).toBe('orphaned')
  })

  it('состояние не изменилось → возвращает null (лишней записи в БД нет)', () => {
    const first = reanchorThread(thread(), [block()], 2, 'ru')
    const settled = thread({
      anchorCurrent: first!.anchorCurrent,
      anchorState: first!.anchorState,
      anchorConfidence: first!.anchorConfidence,
    })
    expect(reanchorThread(settled, [block()], 2, 'ru')).toBeNull()
  })

  it('якорь снова нашёлся после отката → отметка о потере снимается', () => {
    const lost = thread({ anchorState: 'orphaned', anchorChangedAt: 6 })
    const up = reanchorThread(lost, [block()], 8, 'ru')
    expect(up?.anchorState).toBe('anchored')
    expect(up?.anchorChangedAt).toBeNull()
  })

  it('комментарий к заголовку живёт своим полем', () => {
    const t = thread({ field: 'title', anchorOriginal: makeAnchor('Замочить желатин', 0, 8) })
    const up = reanchorThread(t, [block()], 2, 'ru')
    expect(up?.anchorState).toBe('anchored')
    expect(up?.anchorCurrent?.exact).toBe('Замочить')
  })
})
