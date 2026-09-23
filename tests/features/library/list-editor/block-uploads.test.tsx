import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ЗАГРУЗКА В БЛОК НЕ ВИСИТ ВЕЧНО.
 *
 * Вложение и клип шага уходят server action'ом. Экшен, отклонённый до нашего кода
 * (тело больше предела Next, обрыв связи, 500), приходит reject'ом — а хук ждал
 * только `{ error }`: полоса «Загрузка…» не снималась никогда, человек не узнавал
 * ничего (ревью по линзам #974).
 *
 * Подменены только внешние: экшены (граница с сервером; хук и получает их параметром)
 * и тосты sonner.
 */
const toast = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/shared/ui/toast', () => ({ toast }))

const { useBlockUploads } = await import('@/features/library/list-editor/use-block-uploads')

const file = new File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' })

beforeEach(() => toast.error.mockReset())

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
})
