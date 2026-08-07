/**
 * История снимков: шаги, указатель и правила перехода между ними — чистыми
 * функциями, без React.
 *
 * Здесь два разных вида правки. Структурная (`commitStep`) кладёт новый шаг: её
 * отменяют целиком. Правка содержимого (`amendStep`) заменяет верхний снимок — иначе
 * Ctrl+Z отматывал бы набранный текст по букве.
 *
 * Обе обрубают ветку вперёд. Это не мелочь: без обрубания «повторить» после отмены
 * возвращало состояние, построенное на другом прошлом, — то есть теряло только что
 * набранное молча и без следа.
 */
export type History<T> = { steps: T[]; at: number }

export const startHistory = <T,>(initial: T): History<T> => ({ steps: [initial], at: 0 })

export const currentStep = <T,>(h: History<T>): T => h.steps[h.at]

export const canUndo = <T,>(h: History<T>): boolean => h.at > 0
export const canRedo = <T,>(h: History<T>): boolean => h.at < h.steps.length - 1

/** Новый шаг истории. */
export const commitStep = <T,>(h: History<T>, next: T): History<T> => ({ steps: [...h.steps.slice(0, h.at + 1), next], at: h.at + 1 })

/** Правка верхнего снимка: шага не добавляет. */
export const amendStep = <T,>(h: History<T>, next: T): History<T> => ({ steps: [...h.steps.slice(0, h.at), next], at: h.at })

/** Отмена и повтор; за краями истории ничего не происходит. */
export const stepHistory = <T,>(h: History<T>, delta: -1 | 1): History<T> => {
  const at = h.at + delta
  return at < 0 || at > h.steps.length - 1 ? h : { ...h, at }
}
