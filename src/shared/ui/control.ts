// Единая шкала контролов (решение владельца 2026-07-31, линза 07 «интерфейс»):
// кнопка, инпут, селект и поиск В ОДНОМ РЯДУ обязаны совпадать по высоте и кеглю.
// Все примитивы берут размеры ОТСЮДА; свои px/py/text в фичах не пишем.
// Эталон вживую — /admin/ui-kit.

export type ControlSize = 'xs' | 'sm' | 'md'

/** Высота: xs — плотные тулбары/поповеры, sm — панели/фильтры, md — формы.
 *  md = 38px — это записанный стандарт рядов настроек (память
 *  feedback-button-uniform-height-overflow), не круглое число из головы. */
export const CONTROL_H: Record<ControlSize, string> = {
  xs: 'h-7',
  sm: 'h-8',
  md: 'h-[38px]',
}

export const CONTROL_TEXT: Record<ControlSize, string> = {
  xs: 'text-[12.5px]',
  sm: 'text-[13px]',
  md: 'text-[14px]',
}

/** Горизонтальные отступы полей ввода; у Button свои (шире на md — текст в
 *  кнопке дышит), заданы в button.tsx поверх этой же высоты. */
export const CONTROL_PX: Record<ControlSize, string> = {
  xs: 'px-2',
  sm: 'px-2.5',
  md: 'px-3',
}

/** Текст ПОЛЕЙ ВВОДА на мобиле — 16px: меньший кегль заставляет iOS зумить
 *  страницу при фокусе (линза 07, п.1). Кнопок не касается — их не фокусируют
 *  клавиатурой ввода. */
export const FIELD_TEXT_MOBILE = 'max-sm:text-[16px]'

/** Рамочное поле ввода — общая часть Input/Textarea/SelectTrigger. */
export const FIELD_BOX =
  'rounded-md border border-border bg-surface-2 text-ink outline-hidden placeholder:text-muted focus:border-border-strong disabled:opacity-50'
