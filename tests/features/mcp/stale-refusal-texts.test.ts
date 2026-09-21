import { describe, expect, it } from 'vitest'

/**
 * ОТКАЗ «ПРАВКА СОБРАНА НЕ ОТ ТОЙ ВЕРСИИ» — ОДИН НА ОБА ИНСТРУМЕНТА И УЧИТ ШАГУ.
 *
 * Текстов было два и жили они внутри `patch_list`; когда сверку версии завели и у
 * `update_list`, соблазн скопировать формулировку был прямым — а скопированный отказ
 * расходится с оригиналом на первой же правке. Здесь проверяется и общая форма, и
 * обязательная вторая половина: что делать дальше.
 */

const { draftBaseMismatch, staleBase } = await import('@/features/mcp/tools/lists/base-version')

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
