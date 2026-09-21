/**
 * ПРАВКА СОБРАНА НЕ ОТ ТОЙ ВЕРСИИ — два отказа, общих для обоих пишущих инструментов.
 *
 * Модуль отдельный и чистый — по той же причине, что `version-error.ts` у веба: текст
 * отказа хочется проверять тестом, а не глазами, а половина записи (`write.ts`) тянет
 * за собой всю схему БД.
 *
 * Текст ОДИН на `update_list` и `patch_list` намеренно: отказ один и тот же, а две
 * формулировки одного расходятся на первой же правке. Обе половины текста обязательны —
 * что случилось И что делать дальше: агент, которому сказали только «список изменился»,
 * шлёт тот же вызов ещё раз.
 */

/** Правка собрана от версии, которая уже не текущая. */
export const staleBase = (current: number, given: number, what: 'patch' | 'replacement') => ({
  error:
    `list changed: it is at version ${current}, your ${what} is based on ${given}` +
    ` — read it again (get_list) and rebuild the ${what === 'patch' ? 'ops' : 'items'}`,
})

/** То же, но правки копятся в рабочей копии: сверять надо с ЕЁ базой, а не с текущей
 *  версией, — и патч, и полная замена ложатся ПОВЕРХ накопленного. */
export const draftBaseMismatch = (base: number, given: number, what: 'patch' | 'replacement') => ({
  error:
    `your ${what} is based on version ${given}, but the pending edits are based on ${base}` +
    ` — pass baseVersion ${base} (see pendingEdits in get_list), or drop them with discard_draft`,
})
