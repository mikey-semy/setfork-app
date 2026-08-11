/**
 * Ядро предложений правки — БЕЗ 'use server'.
 *
 * Модуль отдельный не для порядка, а по необходимости: любой экспорт из файла с
 * 'use server' — сетевая точка входа, которую клиент зовёт с ЛЮБЫМИ аргументами, а
 * здесь личность действующего лица приходит аргументом. Караул на это стоит
 * (`tests/security/server-action-actor-identity.test.ts`).
 *
 * Вход прежний — `@/features/library/suggestion-core`. Внутри разложено по причинам
 * измениться:
 *
 * | модуль | меняется, когда |
 * |---|---|
 * | `gates` | меняются правила, по которым правку вообще можно принять |
 * | `merge` | меняется, что должно случиться, чтобы правка стала частью списка |
 * | `apply` | меняется принятие правки из пунктов |
 * | `create` | меняется, кому и к какому списку позволено предлагать |
 * | `branch` | меняется, как терминальный путь заводит своё предложение |
 * | `revert` | меняется, как считается вклад правки и его отмена |
 * | `review` | меняются правила вердикта рецензента |
 * | `revision` | меняется, чем опознаётся «то же самое содержимое» |
 * | `limits` | меняется потолок заголовка |
 */
export { SUGGESTION_NOTE_MAX } from './limits'
export { checksGate, reviewGates } from './gates'
export { ensureBranchSuggestion } from './branch'
export { mergeSuggestion } from './merge'
export { applySuggestion } from './apply'
export { createSuggestion } from './create'
export { reviewSuggestion } from './review'
export { revertSuggestion } from './revert'
export { currentRevision } from './revision'
