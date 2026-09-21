import { describe, expect, it } from 'vitest'

/**
 * ОТКАЗ «ПРАВКА СОБРАНА НЕ ОТ ТОЙ ВЕРСИИ» — ОДИН НА ОБА ИНСТРУМЕНТА И УЧИТ ШАГУ.
 *
 * Текстов было два и жили они внутри `patch_list`; когда сверку версии завели и у
 * `update_list`, соблазн скопировать формулировку был прямым — а скопированный отказ
 * расходится с оригиналом на первой же правке. Здесь проверяется и общая форма, и
 * обязательная вторая половина: что делать дальше.
 */

const { draftBaseMismatch, headVersion, staleBase } = await import('@/features/mcp/tools/lists/base-version')

describe('отказ по устаревшей базе', () => {
  it('называет обе версии и отправляет перечитать список', () => {
    const patch = staleBase(7, 5, 'patch').error
    expect(patch).toMatch(/version 7/)
    expect(patch).toMatch(/based on 5/)
    expect(patch, 'без следующего шага агент шлёт тот же вызов ещё раз').toMatch(/get_list/)
  })

  it('автора полной замены не отправляют пересобирать «ops», которых он не слал', () => {
    expect(staleBase(7, 5, 'replacement').error).toMatch(/rebuild the items/)
    expect(staleBase(7, 5, 'patch').error).toMatch(/rebuild the ops/)
  })

  it('у рабочей копии сверяется ЕЁ база, и отказ называет выход из тупика', () => {
    const msg = draftBaseMismatch(4, 6, 'replacement').error
    expect(msg).toMatch(/pending edits are based on 4/)
    expect(msg).toMatch(/pass baseVersion 4/)
    // Тупик «база черновика не та, а сбросить нечем» — отдельный сорт беды.
    expect(msg).toMatch(/discard_draft/)
  })
})

/**
 * НОМЕР ТЕКУЩЕЙ ВЕРСИИ СЧИТАЕТСЯ ОДИН РАЗ.
 *
 * `get_list` называет агенту число, которое наш контракт велит прислать обратно в
 * `baseVersion`. Пока чтение считало его одним способом (строка версии, а если её нет —
 * самая свежая), а запись другим (колонка `current_version`), инструмент отвергал ровно
 * то число, которое сам и выдал: ложный отказ по нашему же контракту.
 */
describe('какой номер считается текущим', () => {
  it('обычный случай: строка с номером колонки на месте', () => {
    expect(headVersion({ currentVersion: 7, versions: [{ version: 7 }, { version: 6 }] })).toBe(7)
  })

  it('строки с номером колонки НЕТ — берём самую свежую, как это делает чтение', () => {
    // Ровно здесь чтение и запись расходились: `get_list` отдавал 6, `update_list` ждал 7.
    expect(headVersion({ currentVersion: 7, versions: [{ version: 6 }, { version: 5 }] })).toBe(6)
  })

  it('версий нет вовсе — остаётся колонка, и это не падение', () => {
    expect(headVersion({ currentVersion: 3, versions: [] })).toBe(3)
  })
})
