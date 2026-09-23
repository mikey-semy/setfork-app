import { vi } from 'vitest'

/**
 * Подмена БРАУЗЕРНОГО декодера и холста для тестов уменьшения картинки. Это внешнее:
 * в jsdom нет ни createImageBitmap, ни рисующего canvas. Само правило (что уходит как
 * есть, во что перекодируется, что шлём при сбое) остаётся настоящим.
 *
 * Снимать подмену — `vi.unstubAllGlobals()` и `vi.restoreAllMocks()` в afterEach.
 */
export function fakeImageApi(opts: {
  /** Размер картинки, который «вернёт» декодер. */
  width: number
  height: number
  /** Сколько байт весит результат кодирования холста. */
  outBytes?: number
  /** Декодер не понял файл (HEIC в Chrome, битый файл). */
  decodeFails?: boolean
  /** Браузер бросил там, где не ждали (освобождение картинки) — проверка того, что
   *  «Загрузка…» не повисает навсегда при сбое вне сети. */
  closeThrows?: boolean
}) {
  const seen = {
    decoded: 0,
    encodedAs: [] as string[],
    smoothing: [] as (string | undefined)[],
    canvases: [] as HTMLCanvasElement[],
  }
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => {
      seen.decoded++
      if (opts.decodeFails) throw new DOMException('The source image could not be decoded.', 'InvalidStateError')
      return {
        width: opts.width,
        height: opts.height,
        close: () => {
          if (opts.closeThrows) throw new DOMException('Detached', 'InvalidStateError')
        },
      }
    }),
  )
  const ctx = { imageSmoothingQuality: undefined as string | undefined, drawImage: () => {} }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
    type = 'image/png',
  ) {
    seen.encodedAs.push(type)
    seen.smoothing.push(ctx.imageSmoothingQuality)
    seen.canvases.push(this)
    cb(new Blob([new Uint8Array(opts.outBytes ?? 100)], { type }))
  })
  return seen
}
