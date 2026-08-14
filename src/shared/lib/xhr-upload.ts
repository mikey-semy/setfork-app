'use client'

// Загрузка файла с РЕАЛЬНЫМ прогрессом отправки. fetch и серверные экшены Next
// прогресс аплоуда не отдают — нужен XHR (`upload.onprogress`). onProgress
// получает 0..100 по мере отправки тела; резолвится распарсенным ответом
// /api/upload, либо бросает Error с текстом сервера.

export interface UploadKindResult {
  'step-image': { key: string; url: string }
  'step-video': { url: string }
  'step-file': { url: string; name: string }
}

export function uploadWithProgress<K extends keyof UploadKindResult>(
  kind: K,
  file: File,
  onProgress: (pct: number) => void,
): Promise<UploadKindResult[K]> {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', kind)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/upload')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      let body: { error?: string } | null = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* тело не JSON — обработаем как ошибку ниже */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body && !body.error) {
        resolve(body as UploadKindResult[K])
      } else {
        reject(new Error(body?.error || `Ошибка загрузки (${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error('Сеть недоступна — попробуйте снова.'))
    xhr.send(fd)
  })
}
