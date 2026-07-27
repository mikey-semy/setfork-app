import { describe, it, expect } from 'vitest'
import { makeAnchor } from '@/features/comments/anchor'
import { threadState } from '@/features/comments/state'
import type { AnchorableBlock } from '@/features/comments/fields'

const DESC = 'Залей желатин 100 мл холодной воды и оставь набухать на 15 минут.'

const block = (over: Partial<AnchorableBlock> = {}): AnchorableBlock => ({
  blockId: 'b1',
  type: 'step',
  title: { ru: 'Замочить желатин' },
  desc: { ru: DESC },
  ...over,
})

const anchorOn = (text: string, sub: string) => {
  const i = text.indexOf(sub)
  return makeAnchor(text, i, i + sub.length)
}

describe('threadState — состояние якоря считается на рендере', () => {
  const a = anchorOn(DESC, 'холодной воды')

  it('блока с такой идентичностью в правке нет → потерян (точный вывод, без догадок)', () => {
    expect(threadState(a, 'desc', 'b1', [block({ blockId: 'other' })], 'ru').state).toBe('orphaned')
  })

  it('текст не менялся → привязан', () => {
    const st = threadState(a, 'desc', 'b1', [block()], 'ru')
    expect(st.state).toBe('anchored')
    if (st.state !== 'orphaned') expect(st.quote).toBe('холодной воды')
  })

  it('вставка выше → якорь едет за цитатой, остаётся привязанным', () => {
    const moved = 'Сначала достань миску. ' + DESC
    const st = threadState(a, 'desc', 'b1', [block({ desc: { ru: moved } })], 'ru')
    expect(st.state).toBe('anchored')
    if (st.state !== 'orphaned') expect(st.quote).toBe('холодной воды')
  })

  it('правка внутри цитаты → перепривязан с уверенностью', () => {
    const edited = DESC.replace('холодной воды', 'холодной кипячёной воды')
    const st = threadState(a, 'desc', 'b1', [block({ desc: { ru: edited } })], 'ru')
    expect(st.state).toBe('reanchored')
    if (st.state === 'reanchored') {
      expect(st.confidence).toBeGreaterThan(0)
      expect(st.confidence).toBeLessThan(100)
    }
  })

  it('поле опустошили → потерян, а не привязка наугад', () => {
    expect(threadState(a, 'desc', 'b1', [block({ desc: { ru: '' } })], 'ru').state).toBe('orphaned')
  })

  it('текст переписали целиком → потерян', () => {
    expect(threadState(a, 'desc', 'b1', [block({ desc: { ru: 'Разогрей духовку до 180.' } })], 'ru').state).toBe('orphaned')
  })

  it('комментарий к заголовку живёт своим полем', () => {
    const st = threadState(anchorOn('Замочить желатин', 'Замочить'), 'title', 'b1', [block()], 'ru')
    expect(st.state).toBe('anchored')
    if (st.state !== 'orphaned') expect(st.quote).toBe('Замочить')
  })

  it('блок без идентичности не матчится (пустой blockId не склеивает блоки)', () => {
    expect(threadState(a, 'desc', 'b1', [block({ blockId: null })], 'ru').state).toBe('orphaned')
  })
})
