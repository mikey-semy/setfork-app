// Единая шкала контролов (решение владельца 2026-07-31, линза 07 «интерфейс»):
// кнопка, инпут, селект и поиск В ОДНОМ РЯДУ обязаны совпадать по высоте и кеглю.
// Все примитивы берут размеры ОТСЮДА; свои px/py/text в фичах не пишем.
// Эталон вживую — /admin/ui-kit.

export type ControlSize = 'xs' | 'sm' | 'md'

/** Высота: xs — плотные тулбары/поповеры, sm — панели/фильтры, md — формы.
 *  Шкала = Primer (GitHub): 28/24/20px. До 01.08.2026 md был 38px (стандарт
 *  рядов настроек того времени); владелец, глядя на /admin/ui-kit, выбрал
 *  компактную плотность («переходим на xs») — вся лестница сдвинута к
 *  Primer small, сайт плотностью как GitHub. */
export const CONTROL_H: Record<ControlSize, string> = {
  xs: 'h-5',
  sm: 'h-6',
  md: 'h-7',
}

export const CONTROL_TEXT: Record<ControlSize, string> = {
  xs: 'text-[0.6875rem]',
  sm: 'text-[0.75rem]',
  md: 'text-[0.78125rem]',
}

/** Горизонтальные отступы полей ввода; у Button свои (шире на md — текст в
 *  кнопке дышит), заданы в button.tsx поверх этой же высоты. */
export const CONTROL_PX: Record<ControlSize, string> = {
  xs: 'px-1.5',
  sm: 'px-2',
  md: 'px-2',
}

/** Текст ПОЛЕЙ ВВОДА на мобиле — 16px: меньший кегль заставляет iOS зумить
 *  страницу при фокусе (линза 07, п.1). Кнопок не касается — их не фокусируют
 *  клавиатурой ввода. */
export const FIELD_TEXT_MOBILE = 'max-sm:text-[1rem]'

// ── Лестница типографики (Ф5a трека ui-system) ──────────────────────────
// До неё в коде жило 20 разных кеглей с полупиксельными шагами (13 ×406,
// 12.5 ×313, 12 ×254, 11 ×134, 11.5 ×130, 13.5 ×108…). Ролей — семь; всё
// новое пишется ролью, свип старого — Ф5b, после него text-[..px] вне
// shared/ui запрещает линт (Ф7). Герои (20/22/24) в лестницу не входят.
export const TEXT = {
  /** Мелкие подписи: бейджи, моно-меты, uppercase-заголовки групп. */
  caption: 'text-[0.6875rem]',
  /** Вторичный текст: подписи полей, хинты, меты. */
  bodySm: 'text-[0.78125rem]',
  /** Основной текст интерфейса. */
  body: 'text-[0.8125rem]',
  /** Крупный текст: поля ввода md, важные абзацы. */
  bodyLg: 'text-[0.875rem]',
  /** Заголовок раздела/секции. */
  title: 'text-[1rem]',
  /** Заголовок страницы (PageHeader). */
  page: 'text-[1.125rem]',
  /** Число-показатель (StatTile). */
  stat: 'text-[1.375rem]',
} as const

/** Размер lucide-иконки при размере контрола: единый вместо 12 разных чисел. */
export const ICON_SIZE: Record<ControlSize, number> = {
  xs: 11,
  sm: 12,
  md: 13,
}

// ── Слои (z-index) ───────────────────────────────────────────────────────
// Вместо случайных z-99/z-100/z-200: навигация/липкие панели ниже дропдаунов,
// дропдауны ниже модалок, тосты поверх всего.
export const LAYER = {
  sticky: 'z-20',
  dropdown: 'z-30',
  overlay: 'z-40',
  modal: 'z-50',
  /** Тултипы и тосты — поверх всего, включая модалки. */
  tooltip: 'z-60',
  toast: 'z-60',
} as const

/** Рамочное поле ввода — общая часть Input/Textarea/SelectTrigger.
 * Фокус обязан быть ВИДИМ (WCAG 2.4.7): текстовые поля браузер считает
 * focus-visible и при клике, так что кольцо показывается всегда.
 * На touch/узких экранах поле не ниже 32px: globals.css форсит там 16px
 * кегль (анти-зум iOS), в компактные 28px он влезает впритык (Codex #651). */
export const FIELD_BOX =
  'rounded-md border border-border bg-surface-2 text-ink outline-hidden placeholder:text-muted focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50 max-sm:min-h-8 pointer-coarse:min-h-8'
