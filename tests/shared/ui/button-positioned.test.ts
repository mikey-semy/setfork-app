import { describe, expect, it } from 'vitest'
import { buttonClass } from '@/shared/ui/button-style'

/**
 * ЗОНА НАЖАТИЯ НЕ ПЕРЕБИВАЕТ ПОЗИЦИОНИРОВАНИЕ, ЗАДАННОЕ ВЫЗЫВАЮЩИМ.
 *
 * Тач-зоне нужен позиционированный предок, и раньше его давал `pointer-coarse:relative`
 * прямо в `TOUCH_HIT`. Если кнопку позиционировал вызывающий (`absolute`), на грубом
 * указателе `relative` его ПЕРЕБИВАЛ: свойство одно (`position`), `pointer-coarse:` идёт
 * вариантом, и tailwind-merge такую пару не сводит — в разметке остаются оба.
 *
 * Кнопка выпадала из абсолютного позиционирования в обычный поток. Найдено 28.08.2026
 * живым замером в браузере и оказалось причиной ДВУХ разных жалоб владельца:
 *  • крестик в панели настроек уезжал вниз, под все поля;
 *  • веер вставки блоков «разъезжался», а «плюс» уходил к правому краю: девять кнопок
 *    выпадали в поток, обойма становилась 404px при экране 390 (замер), и «плюс», как
 *    последний ребёнок, оказывался за краем экрана. Заодно это распирало страницу вширь.
 *
 * ⚠️ Ни глазами, ни статическим счётчиком это не ловится: на мыши `pointer-coarse:` не
 * действует, дефекта нет вовсе. Поэтому проверка смотрит на СТРОКУ КЛАССОВ, а не на вид.
 */
describe('кнопка и позиционирование вызывающего', () => {
  it('позиционированной кнопке зона НЕ навязывает relative', () => {
    const cls = buttonClass({ className: 'absolute top-3 right-3' })
    expect(cls, 'absolute вызывающего обязан уцелеть').toContain('absolute')
    expect(cls, 'relative от зоны перебил бы absolute на грубом указателе').not.toContain('pointer-coarse:relative')
    // Сама зона при этом остаётся: позиционирование ей уже дал вызывающий.
    expect(cls).toContain('pointer-coarse:before:absolute')
  })

  it('обычной кнопке relative по-прежнему нужен: иначе зоне не к чему привязаться', () => {
    expect(buttonClass()).toContain('pointer-coarse:relative')
  })

  it('fixed и sticky считаются позиционированием так же, как absolute', () => {
    for (const p of ['fixed bottom-4', 'sticky top-0']) {
      expect(buttonClass({ className: p }), p).not.toContain('pointer-coarse:relative')
    }
  })
})
