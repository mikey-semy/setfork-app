import { vi } from 'vitest'

/**
 * Подмена БРАУЗЕРНОГО декодера и холста для тестов уменьшения и кадрирования картинки.
 * Это внешнее: в jsdom нет ни createImageBitmap, ни декодера у <img>, ни рисующего
 * canvas, ни URL.createObjectURL. Само правило (что уходит как есть, во что
 * перекодируется, что шлём при сбое) остаётся настоящим.
 *
 * Снимать подмену — `vi.unstubAllGlobals()` и `vi.restoreAllMocks()` в afterEach.
 */
export function fakeImageApi(opts: {
  /** Натуральный размер картинки — как его отдаёт <img> (уже с учётом EXIF-ориентации). */
  width: number
  height: number
  /** Сколько байт весит результат кодирования холста: число — для любого типа,
   *  таблица — по типу (PNG крупнее предела, а JPEG влезает). */
  outBytes?: number | Record<string, number>
  /** Есть ли на холсте прозрачные пиксели (что вернёт getImageData). */
  transparent?: boolean
  /** Типы, которые кодировщик НЕ умеет: вместо них по спеке отдаётся PNG
   *  (Safari с `image/webp`). */
  cannotEncode?: string[]
  /** Декодер не понял файл (HEIC в Chrome, битый файл). */
  decodeFails?: boolean
  /** Браузер бросил там, где не ждали (освобождение картинки) — проверка того, что
   *  «Загрузка…» не повисает навсегда при сбое вне сети. */
  closeThrows?: boolean
}) {
  const seen = {
    /** Сколько раз декодировали в ImageBitmap. */
    decoded: 0,
    /** Опции createImageBitmap — видно, просили ли уменьшенную сразу. */
    bitmapOptions: [] as (ImageBitmapOptions | undefined)[],
    encodedAs: [] as string[],
    canvases: [] as HTMLCanvasElement[],
    objectUrls: { created: [] as string[], revoked: [] as string[] },
  }

  // ── URL.createObjectURL: в jsdom его нет вовсе, поэтому сначала заводим свойство,
  // чтобы spyOn было что подменить (restoreAllMocks вернёт заглушку, которая бросает,
  // как бросил бы вызов несуществующего метода).
  for (const name of ['createObjectURL', 'revokeObjectURL'] as const) {
    if (!(name in URL)) {
      Object.defineProperty(URL, name, {
        configurable: true,
        writable: true,
        value: () => {
          throw new TypeError(`URL.${name} is not a function`)
        },
      })
    }
  }
  let urlSeq = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:fake/${++urlSeq}`
    seen.objectUrls.created.push(url)
    return url
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    seen.objectUrls.revoked.push(url)
  })

  // ── <img>: размер из заголовка, decode() и событие load/error после установки src.
  const proto = HTMLImageElement.prototype
  vi.spyOn(proto, 'naturalWidth', 'get').mockReturnValue(opts.width)
  vi.spyOn(proto, 'naturalHeight', 'get').mockReturnValue(opts.height)
  if (!('decode' in proto)) {
    Object.defineProperty(proto, 'decode', {
      configurable: true,
      writable: true,
      value: () => Promise.reject(new DOMException('decode is not supported', 'EncodingError')),
    })
  }
  vi.spyOn(proto, 'decode').mockImplementation(async () => {
    if (opts.decodeFails) throw new DOMException('The source image cannot be decoded.', 'EncodingError')
  })
  const srcSetter = Object.getOwnPropertyDescriptor(proto, 'src')!.set!
  vi.spyOn(proto, 'src', 'set').mockImplementation(function (this: HTMLImageElement, value: string) {
    srcSetter.call(this, value)
    queueMicrotask(() => this.dispatchEvent(new Event(opts.decodeFails ? 'error' : 'load')))
  })

  // ── createImageBitmap: уменьшает сам, если просили (вторая сторона — по пропорциям).
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (_src: unknown, options?: ImageBitmapOptions) => {
      seen.decoded++
      seen.bitmapOptions.push(options)
      if (opts.decodeFails) throw new DOMException('The source image could not be decoded.', 'InvalidStateError')
      let { width, height } = opts
      if (options?.resizeWidth) [width, height] = [options.resizeWidth, Math.round((height * options.resizeWidth) / width)]
      else if (options?.resizeHeight) [width, height] = [Math.round((width * options.resizeHeight) / height), options.resizeHeight]
      return {
        width,
        height,
        close: () => {
          if (opts.closeThrows) throw new DOMException('Detached', 'InvalidStateError')
        },
      }
    }),
  )

  // ── холст: рисование — пустышка, кодирование отдаёт blob заданного веса.
  const ctx = {
    drawImage: () => {},
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      const data = new Uint8ClampedArray(w * h * 4).fill(255)
      if (opts.transparent) data[data.length - 1] = 0
      return { data, width: w, height: h }
    },
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
    type = 'image/png',
  ) {
    seen.encodedAs.push(type)
    seen.canvases.push(this)
    const actual = opts.cannotEncode?.includes(type) ? 'image/png' : type
    const bytes = typeof opts.outBytes === 'object' ? (opts.outBytes[actual] ?? 100) : (opts.outBytes ?? 100)
    cb(new Blob([new Uint8Array(bytes)], { type: actual }))
  })
  return seen
}
