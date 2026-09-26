import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * КАРТИНКА НЕ УНОСИТ С СОБОЙ, ГДЕ ЕЁ СНЯЛИ.
 *
 * Фото с телефона несёт в EXIF координаты съёмки. Клиентское уменьшение его не
 * спасает: /api/upload, MCP и экшен принимают оригинал, а файл, что уже влез в
 * предел, уходит как есть. Чистит сервер — и это проверяется НАСТОЯЩИМ sharp на
 * настоящих байтах: подмена обработки дала бы зелёный тест при любом её поведении.
 *
 * Подменено только внешнее: выбор хранилища (S3 выключен → диск) и каталог процесса
 * (временный, чтобы не писать в public/ репозитория).
 */
vi.mock('@/shared/settings/media', () => ({ isS3Configured: async () => false }))

// Один каталог на файл: avatar.ts вычисляет свой каталог при импорте модуля.
let root: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'clean-image-'))
  vi.spyOn(process, 'cwd').mockReturnValue(root)
})
afterAll(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

const stepFiles = () => readdir(join(root, 'public', 'uploads', 'steps', 'u1')).catch(() => [] as string[])

const { uploadImageFile } = await import('@/shared/media/upload')

/** Тег указателя на GPS-блок EXIF (0x8825) — в любом порядке байт TIFF. */
const hasGpsIfd = (exif: Buffer | undefined) =>
  !!exif && (exif.includes(Buffer.from([0x25, 0x88])) || exif.includes(Buffer.from([0x88, 0x25])))

/** Снимок «с iPhone»: 40×20 в пикселях, ориентация 6 (повернуть на 90°), GPS, P3-профиль. */
async function phoneJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 20, channels: 3, background: '#c33' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'Apple' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '55/1 45/1 0/1' } })
    .withMetadata({ orientation: 6 })
    .withIccProfile('p3')
    .toBuffer()
}

async function upload(bytes: Buffer, name: string, type = ''): Promise<{ ref: string; stored: Buffer }> {
  const ref = await uploadImageFile('steps/u1', new File([new Uint8Array(bytes)], name, { type }))
  return { ref, stored: await readFile(join(root, 'public', ref)) }
}

describe('uploadImageFile чистит метаданные', () => {
  it('JPEG с GPS → без EXIF, поворот перенесён в пиксели, ICC-профиль на месте', async () => {
    const src = await phoneJpeg()
    const before = await sharp(src).metadata()
    // Предусловие: исходник действительно несёт то, что должно исчезнуть.
    expect(hasGpsIfd(before.exif)).toBe(true)
    expect(before.orientation).toBe(6)

    const { ref, stored } = await upload(src, 'IMG_0001.jpg', 'image/jpeg')
    const after = await sharp(stored).metadata()
    expect(ref).toMatch(/^\/uploads\/steps\/u1\/[\w-]+\.jpg$/)
    expect(after.format).toBe('jpeg')
    expect(after.exif).toBeUndefined()
    expect(after.orientation).toBeUndefined()
    // Портрет стоит портретом без тега: 40×20 с ориентацией 6 → 20×40.
    expect([after.width, after.height]).toEqual([20, 40])
    expect(after.icc).toBeDefined()
  })

  it('PNG с XMP → XMP снят, формат прежний', async () => {
    const src = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#0000' } })
      .png()
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>')
      .toBuffer()
    expect((await sharp(src).metadata()).xmp).toBeDefined()

    const { ref, stored } = await upload(src, 'logo.png')
    const after = await sharp(stored).metadata()
    expect(ref.endsWith('.png')).toBe(true)
    expect(after.xmp).toBeUndefined()
    expect(after.hasAlpha).toBe(true)
  })

  it('анимированный WebP с XMP → чистится всеми кадрами, анимация цела', async () => {
    const frame = (c: string) => sharp({ create: { width: 8, height: 8, channels: 3, background: c } }).png().toBuffer()
    const src = await sharp([await frame('#f00'), await frame('#00f')], { join: { animated: true } })
      .webp()
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>')
      .toBuffer()
    const before = await sharp(src).metadata()
    expect(before.pages).toBe(2)
    expect(before.xmp).toBeDefined()

    const { stored } = await upload(src, 'a.webp')
    const after = await sharp(stored).metadata()
    expect(after.pages).toBe(2)
    expect(after.xmp).toBeUndefined()
  })

  it('картинка без метаданных → байты те же: нечего чистить — нечего и терять', async () => {
    const src = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    const { stored } = await upload(src, 'a.jpg')
    expect(stored.equals(src)).toBe(true)
  })

  it('GIF → байты те же: перекодирование убило бы анимацию', async () => {
    const src = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#0f0' } }).gif().toBuffer()
    const { ref, stored } = await upload(src, 'a.gif')
    expect(ref.endsWith('.gif')).toBe(true)
    expect(stored.equals(src)).toBe(true)
  })

  it('сигнатура JPEG, а внутри мусор → отказ по формату, на диск не пишется ничего', async () => {
    const junk = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 7)])
    const before = (await stepFiles()).length
    await expect(upload(junk, 'a.jpg', 'image/jpeg')).rejects.toMatchObject({ reason: 'bad_type' })
    expect((await stepFiles()).length).toBe(before)
  })

  it('присланный mime не решает: PNG с типом image/jpeg хранится как .png', async () => {
    const src = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer()
    const { ref } = await upload(src, 'a.jpg', 'image/jpeg')
    expect(ref.endsWith('.png')).toBe(true)
  })
})

describe('saveAvatar: формат по сигнатуре и та же очистка', () => {
  it('PNG под именем avatar.webp (Safari после кадрирования) → хранится .png', async () => {
    const { saveAvatar } = await import('@/features/settings/avatar')
    const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#0000' } }).png().toBuffer()
    const ref = await saveAvatar('u1', new File([new Uint8Array(png)], 'avatar.webp', { type: 'image/webp' }))
    expect(ref).toMatch(/^\/uploads\/avatars\/u1-\d+\.png$/)
  })

  it('JPEG с GPS и пустым типом → принят по сигнатуре, EXIF снят', async () => {
    const { saveAvatar } = await import('@/features/settings/avatar')
    const ref = await saveAvatar('u1', new File([new Uint8Array(await phoneJpeg())], 'me.jpg'))
    expect(ref.endsWith('.jpg')).toBe(true)
    const after = await sharp(await readFile(join(root, 'public', ref))).metadata()
    expect(after.exif).toBeUndefined()
  })

  it('не картинка → отказ, даже если тип «image/png»', async () => {
    const { saveAvatar } = await import('@/features/settings/avatar')
    await expect(saveAvatar('u1', new File(['<svg/>'], 'a.png', { type: 'image/png' }))).rejects.toThrow(/формат/)
  })
})
