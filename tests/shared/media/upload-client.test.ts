import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeUploadTransport, okApi } from '../../helpers/fake-upload-transport'
import { isRetryableUpload, uploadErrorText, uploadFile } from '@/shared/media/upload-client'
import { ATTACH_MAX_BYTES } from '@/shared/media/limits'

/**
 * Клиент прямой загрузки: предпроверка → begin → POST в бакет → complete.
 * Подменены только сеть (fetch) и XMLHttpRequest — внешнее.
 */
const pdf = (size = 10, name = 'doc.pdf') => new File([new Uint8Array(size)], name, { type: 'application/pdf' })

afterEach(() => vi.unstubAllGlobals())

describe('uploadFile', () => {
  it('успех: политика → бакет (файл последним полем) → финализация', async () => {
    const t = fakeUploadTransport({ api: okApi() })
    const progress: number[] = []
    const res = await uploadFile('file', pdf(), { onProgress: (f) => progress.push(f) })
    expect(res).toEqual({ url: '/media/files/u/k.pdf', name: 'doc.pdf' })
    expect(t.calls[0]).toEqual({ url: '/api/uploads', body: { kind: 'file', name: 'doc.pdf', size: 10 } })
    expect(t.sent[0]).toMatchObject({ url: 'https://s3.test/bucket', fields: { key: 'files/u/k.pdf', policy: 'p' }, fileName: 'doc.pdf', lastField: 'file' })
    expect(t.calls[1].url).toBe('/api/uploads/u-1/complete')
    expect(progress).toEqual([0.5])
  })

  it('предпроверка режет до сети: ни запроса, ни байта', async () => {
    const t = fakeUploadTransport({ api: okApi() })
    expect(await uploadFile('file', pdf(ATTACH_MAX_BYTES + 1))).toEqual({ error: 'too_big' })
    expect(await uploadFile('file', pdf(10, 'x.svg'))).toEqual({ error: 'bad_type' })
    expect(t.fetchMock).not.toHaveBeenCalled()
  })

  it('S3 не настроен — код сервера доходит как есть, в бакет не ходим', async () => {
    const t = fakeUploadTransport({ api: { '/api/uploads': { status: 503, body: { error: 'storage_unavailable' } } } })
    expect(await uploadFile('file', pdf())).toEqual({ error: 'storage_unavailable' })
    expect(t.sent).toHaveLength(0)
  })

  it('бакет отказал — storage_rejected, финализацию не зовём', async () => {
    const t = fakeUploadTransport({ api: okApi(), storage: 403 })
    expect(await uploadFile('file', pdf())).toEqual({ error: 'storage_rejected' })
    expect(t.calls).toHaveLength(1)
  })

  it('обрыв до бакета (или CORS) — network', async () => {
    fakeUploadTransport({ api: okApi(), storage: 'network' })
    expect(await uploadFile('file', pdf())).toEqual({ error: 'network' })
  })

  it('обрыв до нашего API — network; 429 и 401 — по статусу', async () => {
    fakeUploadTransport({ api: { '/api/uploads': 'network' } })
    expect(await uploadFile('file', pdf())).toEqual({ error: 'network' })
    fakeUploadTransport({ api: { '/api/uploads': { status: 429, body: { error: 'rate_limited', retryAfter: 5 } } } })
    expect(await uploadFile('file', pdf())).toEqual({ error: 'rate_limited' })
    fakeUploadTransport({ api: { '/api/uploads': { status: 401, body: { error: 'unauthorized' } } } })
    expect(await uploadFile('file', pdf())).toEqual({ error: 'unauthorized' })
  })

  it('отказ финализации (подделка по сигнатуре) — её код', async () => {
    fakeUploadTransport({
      api: { ...okApi(), '/api/uploads/u-1/complete': { status: 415, body: { error: 'bad_type' } } },
    })
    expect(await uploadFile('file', pdf())).toEqual({ error: 'bad_type' })
  })

  it('отмена во время POST в бакет — aborted', async () => {
    const t = fakeUploadTransport({ api: okApi(), storage: 'hang' })
    const ctrl = new AbortController()
    const pending = uploadFile('file', pdf(), { signal: ctrl.signal })
    await vi.waitFor(() => expect(t.sent).toHaveLength(1))
    ctrl.abort()
    expect(await pending).toEqual({ error: 'aborted' })
  })
})

describe('uploadErrorText / isRetryableUpload', () => {
  it('у каждой причины есть текст на обоих языках; предел подставлен', () => {
    expect(uploadErrorText('too_big', 'file', 'ru')).toBe('Файл больше 25 МБ.')
    expect(uploadErrorText('too_big', 'video', 'en')).toBe('The file is larger than 50 MB.')
    expect(uploadErrorText('storage_unavailable', 'file', 'ru')).toContain('хранилище')
  })

  it('«Повторить» — для сбоев связи, не для негодного файла и не без хранилища', () => {
    expect(isRetryableUpload('network')).toBe(true)
    expect(isRetryableUpload('storage_rejected')).toBe(true)
    expect(isRetryableUpload('too_big')).toBe(false)
    expect(isRetryableUpload('storage_unavailable')).toBe(false)
  })
})
