import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * «ПЛЮС» МЕЖДУ БЛОКАМИ НЕ НАКРЫВАЕТ КАРТОЧКИ.
 *
 * Дважды сломалось по-разному, поэтому проверяется и место, и размер.
 *
 * 1. МЕСТО. При разрезании редактора на файлы (#696) инсертер переехал ВНУТРЬ карточки
 *    (`{insertAfter}` последним элементом `BlockCard`) и сел на её нижнюю границу,
 *    накрыв содержимое. Найдено владельцем на телефоне 01.09.2026.
 * 2. РАЗМЕР. На грубом указателе у кнопки невидимая тач-зона 44px. В полосе 16px она
 *    не помещалась: при зазоре списка `gap-3` между карточками оставалось 40px, и
 *    цель выходила за него по 2px в каждую сторону — палец попадал по краю карточки.
 *
 * Числа НЕ записаны сюда константами: они читаются из тех же файлов, что рисуют
 * разметку. Иначе тест проверял бы свою копию рецепта и остался бы зелёным после
 * смены шкалы.
 */
const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url).pathname, 'utf8')
const REM = 4 // одна единица шкалы Tailwind = 0.25rem = 4px

describe('вставка блока между карточками', () => {
  it('инсертер живёт не внутри карточки: там он накрывал её содержимое', () => {
    const card = read('src/features/library/list-editor/BlockCard.tsx')
    expect(card).not.toMatch(/BlockInserter|insertAfter/)
  })

  it('тач-цель кнопки целиком помещается в зазор между карточками', () => {
    const inserter = read('src/features/library/list-editor/BlockInserter.tsx')
    const editor = read('src/features/library/list-editor/ListEditor.tsx')
    const control = read('src/shared/ui/control.ts')

    const band = Number(/between \? 'group h-(\d+)/.exec(inserter)?.[1])
    const gap = Number(/<div ref={listRef} className={`flex flex-col gap-(\d+)/.exec(editor)?.[1])
    const touch = Number(/TOUCH_BOX = 'pointer-coarse:size-(\d+)'/.exec(control)?.[1])
    expect([band, gap, touch].every(Number.isFinite), 'разметка изменилась — правило больше не читает числа').toBe(true)

    const between = (band + gap * 2) * REM
    expect(between, `в зазоре ${between}px кнопка ${touch * REM}px не помещается — она накроет карточки`).toBeGreaterThanOrEqual(touch * REM)
  })
})
