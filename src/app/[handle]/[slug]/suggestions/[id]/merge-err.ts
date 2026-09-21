import type { TKey } from '@/shared/i18n'

/**
 * ПОЧЕМУ MERGE НЕ ПРОШЁЛ — словарь кодов отказа, по коду из `?e=`.
 *
 * Отдельным модулем от `load`, а не строкой внутри него: это словарь, а не
 * загрузка данных, и узда на него (`tests/features/library/version-blocked-reason`)
 * обязана читаться без половины слоя запросов. Причина менять у модуля одна —
 * появился новый отказ записи, который человек должен прочитать словами.
 */
export const MERGE_ERR: Record<string, TKey> = {
  // Ответ не ушёл, потому что обсуждение заперли: раньше это был молчаливый `return`,
  // и человек не получал вообще ничего (см. actions/suggestion-comments).
  locked: 'pr.lockedRefused',
  conflict: 'prMergeErrConflict',
  'nothing-to-merge': 'prMergeErrNothing',
  'not-linear': 'prMergeErrNotLinear',
  unresolved: 'prMergeErrUnresolved',
  // Правку не записали, потому что ветку подвинули: чужой пуш не затираем.
  stale: 'prStaleWrite',
  // Применяли предложенную правку, а пункта уже нет — применять некуда.
  orphaned: 'prMergeErrOrphaned',
  // Хранилище списка разошлось с базой: слияние ждёт починки, а не повтора.
  'out-of-sync': 'prMergeErrOutOfSync',
  // Спросить о праве на запись не удалось. Два случая, и советы противоположные:
  // связь сорвалась — повторить; ответ не разобран — повтор бесполезен. Без этих
  // строк оба падали в общий `prMergeErrGeneric` («не удалось»), то есть человек
  // не узнавал ни причины, ни того, ждать ему или нет.
  'gate-unavailable': 'branch.errGateUnavailable',
  'gate-malformed': 'branch.errGateMalformed',
  // Список read-only: принять правку значит создать версию, а её у архивного и
  // замороженного не бывает. Своего гейта у кнопки нет — причину даёт барьер
  // фасада, и без этих строк она падала в общий «не удалось выполнить merge».
  archived: 'bannerArchived',
  frozen: 'bannerFrozen',
}
