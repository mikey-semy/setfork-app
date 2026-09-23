import { describe, expect, it } from 'vitest'
import { fitWithin, shrinkImage, SHRINK_MAX_SIDE } from '@/shared/media/shrink-image'

// Фото с телефона уменьшается ДО отправки: без этого обычный снимок iPhone (3–10 МБ)
// упирался в предел картинки 4 МБ, и обложку было не поставить вовсе.
describe('fitWithin', () => {
  it('вписывает длинную сторону в предел с сохранением пропорций', () => {
    expect(fitWithin(4032, 3024, SHRINK_MAX_SIDE)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3024, 4032, SHRINK_MAX_SIDE)).toEqual({ width: 1200, height: 1600 })
  })

  it('маленькую картинку не увеличивает', () => {
    expect(fitWithin(800, 250, SHRINK_MAX_SIDE)).toEqual({ width: 800, height: 250 })
  })
})

describe('shrinkImage без декодера', () => {
  it('GIF уходит как есть — перекодирование убило бы анимацию', async () => {
    const gif = new File([new Uint8Array(10)], 'a.gif', { type: 'image/gif' })
    expect(await shrinkImage(gif)).toBe(gif)
  })

  it('браузер не умеет декодировать — уходит оригинал, решает сервер', async () => {
    // В jsdom createImageBitmap нет — ровно случай старого браузера.
    const jpg = new File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' })
    expect(await shrinkImage(jpg)).toBe(jpg)
  })
})
