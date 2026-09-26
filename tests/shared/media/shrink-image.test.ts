// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_MAX_BYTES } from '@/shared/media/limits'
import { fitWithin, shrinkImage, SHRINK_MAX_SIDE } from '@/shared/media/shrink-image'
import { fakeImageApi } from '../../helpers/fake-image-api'

// Фото с телефона уменьшается ДО отправки: без этого обычный снимок iPhone (3–10 МБ)
// упирался в предел картинки 4 МБ, и обложку было не поставить вовсе.
//
// jsdom, а не node: правилу нужен document.createElement('canvas'). Подменены только
// браузерные API (декодер <img>, createImageBitmap, кодирование холста) — см.
// helpers/fake-image-api.

const file = (bytes: number, type: string, name = 'a') => new File([new Uint8Array(bytes)], name, { type })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fitWithin', () => {
  it('вписывает длинную сторону в предел с сохранением пропорций', () => {
    expect(fitWithin(4032, 3024, SHRINK_MAX_SIDE)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3024, 4032, SHRINK_MAX_SIDE)).toEqual({ width: 1200, height: 1600 })
  })

  it('маленькую картинку не увеличивает', () => {
    expect(fitWithin(800, 250, SHRINK_MAX_SIDE)).toEqual({ width: 800, height: 250 })
  })
})

describe('shrinkImage', () => {
  it('GIF уходит как есть даже при живом декодере — перекодирование убило бы анимацию', async () => {
    const seen = fakeImageApi({ width: 4000, height: 3000, outBytes: 10 })
    const gif = file(5000, 'image/gif', 'a.gif')
    expect(await shrinkImage(gif)).toBe(gif)
    expect(seen.encodedAs).toEqual([])
  })

  it('PNG, уже влезающий в предел, уходит как есть — без перекодирования', async () => {
    const seen = fakeImageApi({ width: 800, height: 600, outBytes: 10 })
    const png = file(5000, 'image/png', 'logo.png')
    expect(await shrinkImage(png)).toBe(png)
    expect(seen.encodedAs).toEqual([])
  })

  it('крупный PNG → уменьшенный PNG, а не JPEG: прозрачное не становится чёрным', async () => {
    const seen = fakeImageApi({ width: 4000, height: 2000, outBytes: 1000 })
    const out = await shrinkImage(file(5000, 'image/png', 'logo.png'))
    expect(seen.encodedAs).toEqual(['image/png'])
    expect(out.type).toBe('image/png')
    expect(out.name).toBe('logo.png')
    expect(out.size).toBe(1000)
  })

  it('крупный WebP → тоже PNG: альфа сохраняется', async () => {
    const seen = fakeImageApi({ width: 4000, height: 2000, outBytes: 1000 })
    const out = await shrinkImage(file(5000, 'image/webp', 'pic.webp'))
    expect(seen.encodedAs).toEqual(['image/png'])
    expect(out.type).toBe('image/png')
  })

  it('крупный JPEG → уменьшенный JPEG; декодер сразу отдаёт уменьшенную, холст освобождён', async () => {
    const seen = fakeImageApi({ width: 4032, height: 3024, outBytes: 300_000 })
    const out = await shrinkImage(file(6_000_000, 'image/jpeg', 'IMG_0001.HEIC.jpeg'))
    expect(seen.encodedAs).toEqual(['image/jpeg'])
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toBe('IMG_0001.HEIC.jpg')
    expect(out.size).toBe(300_000)
    // Полноразмерный ImageBitmap (48 Мп → ~190 МБ) не заводится: уменьшение — в декодере.
    expect(seen.bitmapOptions).toEqual([{ resizeWidth: 1600, resizeQuality: 'high' }])
    expect([seen.canvases[0].width, seen.canvases[0].height]).toEqual([0, 0])
  })

  it('портрет уменьшается по высоте — длинной стороне', async () => {
    const seen = fakeImageApi({ width: 3024, height: 4032, outBytes: 300_000 })
    await shrinkImage(file(6_000_000, 'image/jpeg', 'a.jpg'))
    expect(seen.bitmapOptions).toEqual([{ resizeHeight: 1600, resizeQuality: 'high' }])
  })

  it('размер узнаётся без отрисовки, objectURL освобождён', async () => {
    const seen = fakeImageApi({ width: 800, height: 600 })
    await shrinkImage(file(5000, 'image/jpeg', 'a.jpg'))
    expect(seen.decoded).toBe(0)
    // decode() раскодировал бы пиксели целиком — ровно то, от чего уходили (48 Мп ≈ 190 МБ).
    expect(HTMLImageElement.prototype.decode).not.toHaveBeenCalled()
    expect(seen.objectUrls.created).toHaveLength(1)
    expect(seen.objectUrls.revoked).toEqual(seen.objectUrls.created)
  })

  it('непрозрачный PNG крупнее предела → JPEG (скриншот без альфы)', async () => {
    const seen = fakeImageApi({
      width: 4000,
      height: 3000,
      outBytes: { 'image/png': IMAGE_MAX_BYTES + 1, 'image/jpeg': 500_000 },
    })
    const out = await shrinkImage(file(9_000_000, 'image/png', 'shot.png'))
    expect(seen.encodedAs).toEqual(['image/png', 'image/jpeg'])
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toBe('shot.jpg')
  })

  it('прозрачный PNG крупнее предела остаётся PNG — прозрачное не чернеет; предел скажет проверка', async () => {
    const seen = fakeImageApi({
      width: 4000,
      height: 3000,
      transparent: true,
      outBytes: { 'image/png': IMAGE_MAX_BYTES + 1, 'image/jpeg': 500_000 },
    })
    const out = await shrinkImage(file(9_000_000, 'image/png', 'logo.png'))
    expect(seen.encodedAs).toEqual(['image/png'])
    expect(out.type).toBe('image/png')
  })

  it('PNG в пределе → JPEG не пробуется, даже если легче: буквы скриншота не мылятся', async () => {
    const seen = fakeImageApi({ width: 4000, height: 3000, outBytes: { 'image/png': 1_000_000, 'image/jpeg': 200_000 } })
    const out = await shrinkImage(file(9_000_000, 'image/png', 'shot.png'))
    expect(seen.encodedAs).toEqual(['image/png'])
    expect(out.type).toBe('image/png')
  })

  it('освобождение картинки бросило → уходит уже уменьшенный файл, исключения наружу нет', async () => {
    fakeImageApi({ width: 4032, height: 3024, outBytes: 300_000, closeThrows: true })
    const out = await shrinkImage(file(6_000_000, 'image/jpeg', 'a.jpg'))
    expect(out.size).toBe(300_000)
  })

  it('перекодированный вышел тяжелее исходника → уходит исходник', async () => {
    fakeImageApi({ width: 4000, height: 3000, outBytes: 9000 })
    const jpg = file(5000, 'image/jpeg', 'a.jpg')
    expect(await shrinkImage(jpg)).toBe(jpg)
  })

  it('декодер не понял файл → уходит оригинал, решает сервер', async () => {
    const seen = fakeImageApi({ width: 4000, height: 3000, decodeFails: true })
    const jpg = file(5000, 'image/jpeg', 'a.jpg')
    expect(await shrinkImage(jpg)).toBe(jpg)
    expect(seen.encodedAs).toEqual([])
    expect(seen.objectUrls.revoked).toEqual(seen.objectUrls.created)
  })

  it('декодера нет вовсе (старый браузер) → уходит оригинал', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const jpg = file(5000, 'image/jpeg', 'a.jpg')
    expect(await shrinkImage(jpg)).toBe(jpg)
  })
})
