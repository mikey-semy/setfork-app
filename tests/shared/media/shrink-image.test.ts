// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fitWithin, shrinkImage, SHRINK_MAX_SIDE } from '@/shared/media/shrink-image'
import { fakeImageApi } from '../../helpers/fake-image-api'

// Фото с телефона уменьшается ДО отправки: без этого обычный снимок iPhone (3–10 МБ)
// упирался в предел картинки 4 МБ, и обложку было не поставить вовсе.
//
// jsdom, а не node: правилу нужен document.createElement('canvas'). Подменены только
// браузерные API (декодер и кодирование холста) — см. helpers/fake-image-api.

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

  it('крупный JPEG → уменьшенный JPEG; сглаживание высокое, холст освобождён', async () => {
    const seen = fakeImageApi({ width: 4032, height: 3024, outBytes: 300_000 })
    const out = await shrinkImage(file(6_000_000, 'image/jpeg', 'IMG_0001.HEIC.jpeg'))
    expect(seen.encodedAs).toEqual(['image/jpeg'])
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toBe('IMG_0001.HEIC.jpg')
    expect(out.size).toBe(300_000)
    expect(seen.smoothing).toEqual(['high'])
    expect([seen.canvases[0].width, seen.canvases[0].height]).toEqual([0, 0])
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
    expect(seen.decoded).toBe(1)
  })

  it('декодера нет вовсе (старый браузер) → уходит оригинал', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const jpg = file(5000, 'image/jpeg', 'a.jpg')
    expect(await shrinkImage(jpg)).toBe(jpg)
  })
})
