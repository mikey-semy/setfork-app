import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeUploadTransport, okApi } from '../../../helpers/fake-upload-transport'

/**
 * ЗАГРУЗКА В БЛОК НЕ ВИСИТ ВЕЧНО.
 *
 * Загрузчик, отклонённый до нашего кода (тело больше предела Next, обрыв связи,
 * 500), приходит reject'ом — а хук ждал только `{ error }`: полоса «Загрузка…» не
 * снималась никогда, человек не узнавал ничего (ревью по линзам #974).
 *
 * Подменены только внешние: загрузчики (граница с сервером; хук и получает их
 * параметром) и тосты sonner. Настоящий путь вложения/клипа — напрямую в S3 — идёт
 * через `serverUploaders` с подменёнными fetch и XMLHttpRequest.
 */
const toast = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/shared/ui/toast', () => ({ toast }))

const { serverUploaders, useBlockUploads } = await import('@/features/library/list-editor/use-block-uploads')

const file = new File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' })

beforeEach(() => toast.error.mockReset())
afterEach(() => vi.unstubAllGlobals())

function setup(fileUploader: (f: File) => Promise<{ error: string; retry?: boolean } | { fileUrl: string; fileName: string }>) {
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

  it('отказ с retry — текст и «Повторить»', async () => {
    const { result } = setup(async () => ({ error: 'Связь пропала', retry: true }))
    await act(() => result.current.upload('b1', 'file', file))
    const [text, opts] = toast.error.mock.calls[0] as [string, { action: { label: string } }]
    expect(text).toBe('Связь пропала')
    expect(opts.action.label).toBe('Повторить')
  })

  it('отказ сервера кодом — его текст, без «Повторить» по сети', async () => {
    const { result } = setup(async () => ({ error: 'Файл больше 25 МБ' }))
    await act(() => result.current.upload('b1', 'file', file))
    expect(toast.error).toHaveBeenCalledWith('Файл больше 25 МБ')
    expect(result.current.isBusy('b1', 'file')).toBe(false)
  })
})

describe('serverUploaders: вложение и клип — напрямую в S3', () => {
  function withServer() {
    const patch = vi.fn()
    const { result } = renderHook(() => useBlockUploads(patch, 'ru', serverUploaders))
    return { result, patch }
  }

  it('вложение: ссылка /media/… и имя ложатся в блок', async () => {
    const t = fakeUploadTransport({ api: okApi('/media/files/u/k.pdf', 'doc.pdf') })
    const { result, patch } = withServer()
    await act(() => result.current.upload('b1', 'file', file))
    expect(patch).toHaveBeenCalledWith('b1', { fileUrl: '/media/files/u/k.pdf', fileName: 'doc.pdf' })
    expect(t.sent).toHaveLength(1) // файл ушёл в бакет, а не в server action
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('клип: ссылка ложится в videoUrl', async () => {
    fakeUploadTransport({ api: okApi('/media/videos/u/k.mp4', 'clip.mp4') })
    const { result, patch } = withServer()
    await act(() => result.current.upload('b1', 'video', new File([new Uint8Array(10)], 'clip.mp4', { type: 'video/mp4' })))
    expect(patch).toHaveBeenCalledWith('b1', { videoUrl: '/media/videos/u/k.mp4' })
  })

  it('без S3 — понятная причина, без «Повторить», занятость снята', async () => {
    fakeUploadTransport({ api: { '/api/uploads': { status: 503, body: { error: 'storage_unavailable' } } } })
    const { result, patch } = withServer()
    await act(() => result.current.upload('b1', 'file', file))
    expect(patch).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('не настроено хранилище'))
    expect(toast.error.mock.calls[0]).toHaveLength(1)
    expect(result.current.isBusy('b1', 'file')).toBe(false)
  })

  it('обрыв до бакета — причина и «Повторить», повтор идёт заново', async () => {
    const t = fakeUploadTransport({ api: okApi(), storage: 'network' })
    const { result } = withServer()
    await act(() => result.current.upload('b1', 'file', file))
    const [text, opts] = toast.error.mock.calls[0] as [string, { action: { onClick: () => void } }]
    expect(text).toContain('пропала связь')
    await act(async () => opts.action.onClick())
    await vi.waitFor(() => expect(t.sent).toHaveLength(2))
  })
})
