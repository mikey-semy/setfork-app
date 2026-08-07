/**
 * Геометрия переноса карточек — чистые функции без React и без DOM.
 *
 * Отдельно от block-ops: там операции над СОСТАВОМ списка, здесь — арифметика
 * «куда целится указатель». Обе стороны проверяются юнит-тестами, потому что
 * ошибка в любой из них проявляется одинаково незаметно: блок встаёт не туда,
 * куда показывала линия.
 */

/** Полоса карточки по вертикали в координатах ДОКУМЕНТА, а не окна. */
export type Band = { top: number; bottom: number }

/** Куда встанет блок относительно карточки `over`. */
export type Aim = { over: number; side: 'before' | 'after' }

/**
 * Порог начала переноса. Пока указатель не отъехал дальше, это ещё тап или клик:
 * палец всегда немного «плывёт» при касании. 8px — touch slop Android
 * (ViewConfiguration.TOUCH_SLOP = 8dp), у iOS порог того же порядка.
 */
const START_PX = 8

/** Сдвиг достаточен, чтобы считать нажатие переносом, а не тапом. */
export const movedEnough = (fromX: number, fromY: number, x: number, y: number): boolean => Math.hypot(x - fromX, y - fromY) >= START_PX

/**
 * Зона у края экрана, в которой список едет сам, и предел скорости за кадр.
 *
 * Без автоскролла перенос пальцем упирается в размер экрана: карточка шага занимает
 * около двух третей видимой высоты телефона, и следующая цель уже за краем.
 * 64px — это примерно полторы тач-цели: попасть в зону легко, случайно задеть её
 * серединой экрана нельзя. 18px за кадр — около 1000px/с при 60 кадрах, то есть
 * экран телефона проезжает примерно за секунду.
 */
const EDGE_PX = 64
const MAX_STEP_PX = 18

/**
 * На сколько прокрутить страницу, когда указатель у края окна.
 * Возврат в пикселях за кадр: отрицательное — вверх, 0 — стоим.
 */
export function edgeScrollStep(clientY: number, viewportHeight: number): number {
  const intoTop = EDGE_PX - clientY
  if (intoTop > 0) return -Math.round(MAX_STEP_PX * Math.min(1, intoTop / EDGE_PX))
  const intoBottom = clientY - (viewportHeight - EDGE_PX)
  if (intoBottom > 0) return Math.round(MAX_STEP_PX * Math.min(1, intoBottom / EDGE_PX))
  return 0
}

/**
 * Куда целится точка `y` (координата документа) при заданных полосах карточек.
 *
 * За пределами списка целью становится его край — иначе перенос в самое начало или
 * конец требовал бы попасть точно в карточку. В зазоре между карточками цель —
 * нижняя кромка верхней: это то же место вставки, что и верхняя кромка нижней.
 */
export function targetAt(bands: Band[], y: number): Aim | null {
  if (!bands.length) return null
  const last = bands.length - 1
  if (y <= bands[0].top) return { over: 0, side: 'before' }
  if (y >= bands[last].bottom) return { over: last, side: 'after' }

  const inside = bands.findIndex((b) => y >= b.top && y <= b.bottom)
  if (inside >= 0) {
    const { top, bottom } = bands[inside]
    return { over: inside, side: y < (top + bottom) / 2 ? 'before' : 'after' }
  }
  const below = bands.findIndex((b) => b.top > y)
  return { over: below - 1, side: 'after' }
}
