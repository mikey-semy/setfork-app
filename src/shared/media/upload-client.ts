import { fill, type Lang, type TKey } from '@/shared/i18n'
import {
  megabytes,
  uploadRejection,
  UPLOAD_KINDS,
  type UploadErrorCode,
  type UploadKind,
} from './limits'

/**
 * Прямая загрузка тяжёлого файла из браузера в S3 — клиентская половина
 * `shared/media/direct-upload` (форма GitHub.com):
 *
 *   1. предпроверка по той же таблице, что у сервера (`uploadRejection`);
 *   2. `POST /api/uploads` → подписанная политика на ключ, придуманный сервером;
 *   3. POST файла в бакет (XMLHttpRequest — ради прогресса; у fetch его на отправке нет);
 *   4. `POST /api/uploads/<id>/complete` → сервер проверил объект, ссылка `/media/…`.
 *
 * Не бросает: любой исход — `{ url, name }` или `{ error: код }`. Текст причины —
 * `uploadErrorText`, на языке человека.
 */
export type UploadResult = { url: string; name: string } | { error: UploadErrorCode }

type Options = { onProgress?: (fraction: number) => void; signal?: AbortSignal }

const SERVER_CODES: ReadonlySet<string> = new Set<UploadErrorCode>([
  'empty',
  'too_big',
  'bad_type',
  'storage_unavailable',
  'bad_request',
  'not_found',
  'not_uploaded',
])

/** Код отказа из ответа нашего API: известный код из тела, иначе — по статусу. */
async function apiError(res: Response): Promise<UploadErrorCode> {
  const data = (await res.json().catch(() => null)) as { error?: unknown } | null
  if (typeof data?.error === 'string' && SERVER_CODES.has(data.error)) return data.error as UploadErrorCode
  if (res.status === 429) return 'rate_limited'
  if (res.status === 401) return 'unauthorized'
  return 'server_error'
}

async function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<Response | UploadErrorCode> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    return signal?.aborted ? 'aborted' : 'network'
  }
}

/** POST формы в бакет. Поле `file` обязано идти ПОСЛЕДНИМ — S3 игнорирует поля после него. */
function postToStorage(url: string, fields: Record<string, string>, file: File, opts: Options): Promise<UploadErrorCode | null> {
  return new Promise((resolve) => {
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    form.append('file', file)

    const xhr = new XMLHttpRequest()
    const onAbort = () => xhr.abort()
    const done = (result: UploadErrorCode | null) => {
      opts.signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }
    xhr.open('POST', url)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opts.onProgress?.(e.loaded / e.total)
    }
    // Статус 0 — ответ не дошёл: обрыв или CORS бакета (браузер прячет причину).
    xhr.onload = () => done(xhr.status >= 200 && xhr.status < 300 ? null : 'storage_rejected')
    xhr.onerror = () => done('network')
    xhr.onabort = () => done('aborted')
    if (opts.signal?.aborted) return done('aborted')
    opts.signal?.addEventListener('abort', onAbort)
    xhr.send(form)
  })
}

export async function uploadFile(kind: UploadKind, file: File, opts: Options = {}): Promise<UploadResult> {
  const rejected = uploadRejection(kind, file)
  if (rejected) return { error: rejected }

  const begun = await postJson('/api/uploads', { kind, name: file.name, size: file.size }, opts.signal)
  if (typeof begun === 'string') return { error: begun }
  if (!begun.ok) return { error: await apiError(begun) }
  const policy = (await begun.json().catch(() => null)) as { id: string; url: string; fields: Record<string, string> } | null
  if (!policy?.id || !policy.url) return { error: 'server_error' }

  const stored = await postToStorage(policy.url, policy.fields, file, opts)
  if (stored) return { error: stored }

  const completed = await postJson(`/api/uploads/${encodeURIComponent(policy.id)}/complete`, {}, opts.signal)
  if (typeof completed === 'string') return { error: completed }
  if (!completed.ok) return { error: await apiError(completed) }
  const result = (await completed.json().catch(() => null)) as { url: string; name: string } | null
  return result?.url ? result : { error: 'server_error' }
}

/** Код → i18n-ключ. Record, а не шаблон строки: новый код без текста не соберётся. */
const ERROR_TEXT: Record<UploadErrorCode, TKey> = {
  empty: 'upload.error.empty',
  too_big: 'upload.error.too_big',
  bad_type: 'upload.error.bad_type',
  storage_unavailable: 'upload.error.storage_unavailable',
  bad_request: 'upload.error.bad_request',
  not_found: 'upload.error.not_found',
  not_uploaded: 'upload.error.not_uploaded',
  network: 'upload.error.network',
  storage_rejected: 'upload.error.storage_rejected',
  rate_limited: 'upload.error.rate_limited',
  unauthorized: 'upload.error.unauthorized',
  server_error: 'upload.error.server_error',
  aborted: 'upload.error.aborted',
}

/** Понятная причина отказа на языке человека; `{n}` — предел вида в МБ. */
export function uploadErrorText(code: UploadErrorCode, kind: UploadKind, lang: Lang): string {
  return fill(ERROR_TEXT[code], lang, { n: megabytes(UPLOAD_KINDS[kind].maxBytes) })
}

/**
 * Есть ли смысл в «Повторить»: сбой связи или сервера — да; сам файл не годится
 * (размер, тип) или хранилище не настроено — повтор даст тот же отказ.
 */
export function isRetryableUpload(code: UploadErrorCode): boolean {
  return code === 'network' || code === 'storage_rejected' || code === 'server_error' || code === 'not_uploaded' || code === 'rate_limited'
}
