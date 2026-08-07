/**
 * Что означает нажатие в редакторе — чистой функцией, без React и без DOM.
 *
 * Раньше разбор клавиш жил обработчиком внутри компонента и проверялся только руками.
 * Тут легко ошибиться незаметно: перехватить Ctrl+Z в поле ввода — значит отобрать у
 * человека браузерную отмену набранного текста, а не перехватить Alt+↑ — оставить
 * клавиатуру без единственного способа двигать блок.
 */
export type EditorCommand = { kind: 'undo' } | { kind: 'redo' } | { kind: 'move'; dir: -1 | 1 }

export type KeyIntent = {
  key: string
  /** Ctrl или ⌘ — они равнозначны. */
  mod: boolean
  shift: boolean
  alt: boolean
  /** Курсор стоит в поле ввода: там у браузера свои отмена и повтор. */
  inField: boolean
}

/** Команда редактора по нажатию; null — нажатие нас не касается. */
export function commandFor({ key, mod, shift, alt, inField }: KeyIntent): EditorCommand | null {
  const k = key.toLowerCase()
  if (mod && (k === 'z' || k === 'y')) {
    // В поле ввода отмену не перехватываем: браузерная отматывает НАБРАННЫЙ ТЕКСТ,
    // и подменять её отменой структурной правки — значит терять слова человека.
    if (inField) return null
    return k === 'y' || shift ? { kind: 'redo' } : { kind: 'undo' }
  }
  // Alt+↑/↓ работают и в поле: это единственный способ двигать блок с клавиатуры,
  // а сочетание в текстовом поле ничего своего не значит.
  if (alt && (key === 'ArrowUp' || key === 'ArrowDown')) return { kind: 'move', dir: key === 'ArrowUp' ? -1 : 1 }
  return null
}
