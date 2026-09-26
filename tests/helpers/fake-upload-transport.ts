import { vi } from 'vitest'

/**
 * Подмена ВНЕШНЕГО для прямой загрузки: сеть до нашего API (`fetch`) и POST в бакет
 * (`XMLHttpRequest`). Всё, что между ними, — настоящий код клиента.
 *
 * `api` — ответы нашего API по пути; `storage` — исход POST в бакет: статус ответа
 * (204 — успех S3 по умолчанию), `'network'` (обрыв/CORS) или `'hang'` (ждёт отмены).
 */
export type StorageOutcome = number | 'network' | 'hang'

export function fakeUploadTransport(opts: {
  api: Record<string, { status: number; body: unknown } | 'network'>
  storage?: StorageOutcome
}) {
  const calls: { url: string; body: unknown }[] = []
  const sent: { url: string; fields: Record<string, string>; fileName: string | null; lastField: string }[] = []

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    const route = Object.entries(opts.api).find(([p]) => url === p || (p.includes('*') && url.startsWith(p.split('*')[0])))
    if (!route) throw new Error(`неожиданный запрос ${url}`)
    const r = route[1]
    if (r === 'network') throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
  })

  class FakeXHR {
    status = 0
    upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null }
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    private url = ''
    open(_m: string, url: string) {
      this.url = url
    }
    abort() {
      queueMicrotask(() => this.onabort?.())
    }
    send(form: FormData) {
      const fields: Record<string, string> = {}
      let fileName: string | null = null
      let lastField = ''
      for (const [k, v] of form.entries()) {
        lastField = k
        if (typeof v === 'string') fields[k] = v
        else fileName = v.name
      }
      sent.push({ url: this.url, fields, fileName, lastField })
      const outcome = opts.storage ?? 204
      if (outcome === 'hang') return
      queueMicrotask(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 })
        if (outcome === 'network') return this.onerror?.()
        this.status = outcome
        this.onload?.()
      })
    }
  }

  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  return { calls, sent, fetchMock }
}

/** Ответы API успешной загрузки. */
export const okApi = (url = '/media/files/u/k.pdf', name = 'doc.pdf') => ({
  '/api/uploads': { status: 200, body: { id: 'u-1', url: 'https://s3.test/bucket', fields: { key: 'files/u/k.pdf', policy: 'p' } } },
  '/api/uploads/u-1/complete': { status: 200, body: { url, name } },
})
