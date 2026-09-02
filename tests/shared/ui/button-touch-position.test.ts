import { describe, expect, it } from 'vitest'
import { buttonClass } from '@/shared/ui/button-style'

/**
 * Зона нажатия не должна ломать позиционирование вызывающего.
 *
 * `pointer-coarse:relative` из зоны и `absolute` вызывающего — одно свойство, и вариант
 * сильнее: на телефоне побеждает зона, элемент выпадает в поток и уезжает. Так уезжали
 * крестик панели настроек и веер вставки блоков, а 02.09.2026 — невидимая ссылка
 * «перейти к содержимому», отжавшая шапку сайта от верха на 24px.
 */
describe('зона нажатия и позиционирование', () => {
  const zone = 'pointer-coarse:relative'

  it('обычной кнопке зона нужна вместе с relative', () => {
    expect(buttonClass()).toContain(zone)
  })

  for (const cls of ['absolute right-2', 'fixed bottom-4', 'sticky top-0']) {
    it(`«${cls}» — вызывающий позиционировал сам, relative не подмешиваем`, () => {
      expect(buttonClass({ className: cls })).not.toContain(zone)
    })
  }

  it('sr-only — это тоже absolute, просто одним словом', () => {
    // ⚠️ Ровно этот случай отжимал шапку от верха на телефоне: ссылка «перейти к
    // содержимому» скрыта, пока не получит фокус, и в потоке её быть не должно.
    expect(buttonClass({ className: 'sr-only size-px focus:not-sr-only focus:fixed' })).not.toContain(zone)
  })

  it('зона нажатия при этом остаётся — она привязывается к чужому позиционированию', () => {
    expect(buttonClass({ className: 'sr-only' })).toContain('pointer-coarse:before:absolute')
  })
})
