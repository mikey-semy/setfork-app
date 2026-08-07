'use client'

import { useState } from 'react'
import { amendStep, canRedo, canUndo, commitStep, currentStep, startHistory, stepHistory } from './history'

/**
 * История снимков с отменой и повтором — одна ответственность, без знания о том,
 * что за состояние внутри. Правила переходов живут в history.ts и проверяются
 * тестами; здесь только связь с React.
 *
 * Все изменения идут ФУНКЦИЕЙ от актуального снимка. Это не стиль, а требование:
 * загрузка файла возвращается через секунды, и обработчик, замкнувшийся на снимок
 * времён своего рендера, затирал бы всё, что человек успел сделать за это время.
 */
export function useUndoRedo<T>(initial: T) {
  const [history, setHistory] = useState(() => startHistory(initial))

  return {
    current: currentStep(history),
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    /** Новый шаг истории (структурная правка). */
    commit: (next: (cur: T) => T) => setHistory((h) => commitStep(h, next(currentStep(h)))),
    /** Правка верхнего снимка, без нового шага (содержимое блока). */
    amend: (next: (cur: T) => T) => setHistory((h) => amendStep(h, next(currentStep(h)))),
    undo: () => setHistory((h) => stepHistory(h, -1)),
    redo: () => setHistory((h) => stepHistory(h, 1)),
  }
}
