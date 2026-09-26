import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_MAX_BYTES, megabytes } from '@/shared/media/limits'
import { fakeImageApi } from '../../../helpers/fake-image-api'

/**
 * ЗАГРУЗКА В БЛОК НЕ ВИСИТ ВЕЧНО.
 *
 * Вложение и клип шага уходят server action'ом. Экшен, отклонённый до нашего кода
 * (тело больше предела Next, обрыв связи, 500), приходит reject'ом — а хук ждал
 * только `{ error }`: полоса «Загрузка…» не снималась никогда, человек не узнавал
 * ничего (ревью по линзам #974).
 *
 * Подменены только внешние: экшены (граница с сервером; хук и получает их параметром),
 * тосты sonner и (где нужно) браузерный декодер с холстом. Уменьшение картинки и
 * проверка предела — настоящие.
 */
const toast = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/shared/ui/toast', () => ({ toast }))

const { useBlockUploads } = await import('@/features/library/list-editor/use-block-uploads')

const file = new File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' })

beforeEach(() => toast.error.mockReset())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function setup(fileUploader: (f: FormData) => Promise<{ error: string } | { fileUrl: string; fileName: string }>) {
  const patch = vi.fn()
  const uploaders = { image: vi.fn(), video: vi.fn(), file: vi.fn(fileUploader) }
  const { result } = renderHook(() => useBlockUploads(patch, 'ru', uploaders))
  return { result, patch, uploaders }
}

describe('useBlockUploads', () => {
  it('экшен отклонён → «Загрузка…» снята, причина и «Повторить»', async () => {
    const { result, uploaders } = setup(async () => {
      throw new Error('Body exceeded 1 MB limit')
    })
    await act(() => result.current.upload('b1', 'file', file))

    expect(result.current.isBusy('b1', 'file')).toBe(false)
    expect(toast.error).toHaveBeenCalledTimes(1)
    const [text, opts] = toast.error.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }]
    expect(text).toContain('не загрузился')
    expect(opts.action.label).toBe('Повторить')

    uploaders.file.mockResolvedValueOnce({ fileUrl: '/f.pdf', fileName: 'doc.pdf' })
    await act(async () => opts.action.onClick())
    expect(uploaders.file).toHaveBeenCalledTimes(2)
  })

  it('успех кладёт результат в блок и снимает занятость', async () => {
    const { result, patch } = setup(async () => ({ fileUrl: '/f.pdf', fileName: 'doc.pdf' }))
    await act(() => result.current.upload('b1', 'file', file))
    expect(patch).toHaveBeenCalledWith('b1', { fileUrl: '/f.pdf', fileName: 'doc.pdf' })
    expect(result.current.isBusy('b1', 'file')).toBe(false)
  })

  it('отказ сервера кодом — его текст, без «Повторить» по сети', async () => {
    const { result } = setup(async () => ({ error: 'Файл больше 25 МБ' }))
    await act(() => result.current.upload('b1', 'file', file))
    expect(toast.error).toHaveBeenCalledWith('Файл больше 25 МБ')
    expect(result.current.isBusy('b1', 'file')).toBe(false)
  })

  describe('картинка', () => {
    type ImageUploader = (f: FormData) => Promise<{ error: string } | { imageKey: string; imagePreview: string }>
    function setupImage(imageUploader: ImageUploader) {
      const patch = vi.fn()
      const uploaders = { image: vi.fn(imageUploader), video: vi.fn(), file: vi.fn() }
      const { result } = renderHook(() => useBlockUploads(patch, 'ru', uploaders))
      return { result, patch, uploaders }
    }
    const photo = (bytes: number, type = 'image/jpeg') => new File([new Uint8Array(bytes)], 'IMG_0001.jpg', { type })

    it('фото 6 МБ уменьшается ДО проверки предела и уходит на сервер, а не отказом «больше 4 МБ»', async () => {
      fakeImageApi({ width: 4032, height: 3024, outBytes: 300_000 })
      const { result, uploaders, patch } = setupImage(async () => ({ imageKey: 'k', imagePreview: '/p.jpg' }))
      await act(() => result.current.upload('b1', 'image', photo(6 * 1024 * 1024)))

      expect(uploaders.image).toHaveBeenCalledTimes(1)
      const sent = (uploaders.image.mock.calls[0][0] as FormData).get('file') as File
      expect(sent.size).toBe(300_000)
      expect(sent.type).toBe('image/jpeg')
      expect(toast.error).not.toHaveBeenCalled()
      expect(patch).toHaveBeenCalledWith('b1', { imageKey: 'k', imagePreview: '/p.jpg' })
    })

    it('больше предела и не уменьшилась → причина с размером сразу, на сервер не уходит', async () => {
      // Без подмены декодера в jsdom его нет — файл остаётся как есть.
      const { result, uploaders } = setupImage(async () => ({ imageKey: 'k', imagePreview: '/p.jpg' }))
      await act(() => result.current.upload('b1', 'image', photo(IMAGE_MAX_BYTES + 1)))

      expect(uploaders.image).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledTimes(1)
      const [text, opts] = toast.error.mock.calls[0] as [string, unknown]
      expect(text).toContain(`${megabytes(IMAGE_MAX_BYTES)} МБ`)
      // Тот же файл не станет меньше — «Повторить» с ним бессмысленно.
      expect(opts).toBeUndefined()
      expect(result.current.isBusy('b1', 'image')).toBe(false)
    })

    it('формат не из списка (HEIC) → причина сразу, на сервер не уходит', async () => {
      const { result, uploaders } = setupImage(async () => ({ imageKey: 'k', imagePreview: '/p.jpg' }))
      await act(() => result.current.upload('b1', 'image', photo(1000, 'image/heic')))

      expect(uploaders.image).not.toHaveBeenCalled()
      expect(toast.error.mock.calls[0][0]).toContain('PNG, JPG, WEBP или GIF')
    })
  })
})
