import { describe, expect, it } from 'vitest'
// Та же копия разборщика, которой Next читает `bodySizeLimit` (action-handler.js).
// @ts-expect-error -- у встроенной копии Next нет файла типов; берём её сознательно
import bytes from 'next/dist/compiled/bytes'
import config from '../../next.config.mjs'
import { IMAGE_MAX_BYTES } from '@/shared/media/limits'

/**
 * ПРЕДЕЛ ТЕЛА ЭКШЕНА НЕ МЕНЬШЕ ПРЕДЕЛА КАРТИНКИ.
 *
 * Картинки (обложка списка, скриншот шага, аватарка эксперта) уходят server action'ом,
 * а Next по умолчанию пускает в экшен тело до 1 МБ. Сервер обещал 4 МБ, но файл в
 * 1–4 МБ отклонялся ДО нашего кода: клиент получал голый reject, а обложка на iPhone
 * «просто не менялась». Число в next.config.mjs не выведено из limits.ts (конфиг —
 * .mjs), поэтому связь держит этот тест.
 *
 * Меряем ПОВЕДЕНИЕМ: собираем настоящее multipart-тело, какое шлёт форма обложки с
 * файлом ровно на пределе, и сравниваем с тем, что Next насчитает из конфига. Сравнение
 * с голым IMAGE_MAX_BYTES пропустило бы предел «впритык», который режет обёртку.
 */
const DEFAULT_ACTION_BODY = 1024 * 1024 // как в Next: без bodySizeLimit — 1 МБ

function actionBodyLimit(): number {
  const raw = (config as unknown as { experimental?: { serverActions?: { bodySizeLimit?: string | number } } }).experimental?.serverActions
    ?.bodySizeLimit
  return raw === undefined ? DEFAULT_ACTION_BODY : (bytes.parse(raw) as number)
}

describe('bodySizeLimit экшенов и предел картинки', () => {
  it('форма обложки с файлом на пределе проходит в экшен целиком', async () => {
    const fd = new FormData()
    fd.append('templateId', '00000000-0000-0000-0000-000000000000')
    fd.append('file', new File([new Uint8Array(IMAGE_MAX_BYTES)], 'IMG_0001.jpg', { type: 'image/jpeg' }))
    const body = (await new Response(fd).arrayBuffer()).byteLength

    expect(body).toBeGreaterThan(IMAGE_MAX_BYTES)
    expect(actionBodyLimit()).toBeGreaterThanOrEqual(body)
  })
})
