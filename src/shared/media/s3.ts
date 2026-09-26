import 'server-only'
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetBucketCorsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  type CORSRule,
} from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getMediaSettings, type MediaSettings } from '@/shared/settings/media'

/**
 * С каким бакетом работаем.
 *   * `main` — картинки и аватары (imgproxy читает отсюда), всегда path-style;
 *   * `uploads` — прямые загрузки браузером (вложения, клипы). Свой бакет, потому что
 *     браузеру нужен CORS, а у Selectel CORS работает ТОЛЬКО с виртуальным хостом
 *     (`бакет.s3…`); тип адресации задаётся при создании бакета, и имя с точкой
 *     (`setfork.data`) не покрывается сертификатом `*.s3.ru-3.storage.selcloud.ru`.
 *     Пустое имя → основной бакет (dev-MinIO и любой S3 без этой беды).
 */
export type S3Target = 'main' | 'uploads'

/** Куда и как ходить для цели — чистая функция, одно место на выбор бакета и стиля. */
export function s3Target(s: MediaSettings, target: S3Target): { bucket: string; forcePathStyle: boolean } {
  if (target === 'uploads') return { bucket: s.s3UploadsBucket || s.s3Bucket, forcePathStyle: !s.s3UploadsVhost }
  return { bucket: s.s3Bucket, forcePathStyle: true } // Selectel/MinIO — path-style (бакет в пути)
}

async function client(target: S3Target = 'main'): Promise<{ s3: S3Client; bucket: string; prefix: string }> {
  const s = await getMediaSettings()
  const { bucket, forcePathStyle } = s3Target(s, target)
  const s3 = new S3Client({
    endpoint: s.s3Endpoint,
    region: s.s3Region,
    forcePathStyle,
    credentials: { accessKeyId: s.s3AccessKey, secretAccessKey: s.s3SecretKey },
  })
  return { s3, bucket, prefix: s.s3Prefix }
}

const withPrefix = (prefix: string, key: string) => (prefix ? `${prefix}/${key}` : key)

/** Загрузка объекта. Возвращает storage_key (без префикса окружения). */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<string> {
  const { s3, bucket, prefix } = await client()
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: withPrefix(prefix, key),
      Body: body,
      ContentType: contentType,
      CacheControl: 'max-age=31536000', // 1 год — оригиналы неизменяемы (uuid в имени)
    }),
  )
  return key
}

/** Удаляет один объект по storage_key. */
export async function deleteObject(key: string, target: S3Target): Promise<void> {
  const { s3, bucket, prefix } = await client(target)
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: withPrefix(prefix, key) }))
}

/** Удаляет все объекты под префиксом (напр. avatars/{userId}/). */
export async function deleteByPrefix(keyPrefix: string): Promise<void> {
  const { s3, bucket, prefix } = await client()
  const listed = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: withPrefix(prefix, keyPrefix) }),
  )
  const objects = (listed.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((o) => o.Key)
  if (objects.length === 0) return
  await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }))
}

// ── Бакет ПРЯМЫХ ЗАГРУЗОК (`uploads`): всё ниже работает только с ним ──────────

/**
 * Подписанная POST-политика для загрузки браузером НАПРЯМУЮ в бакет (форма GitHub.com:
 * policy → браузер POST в S3 → финализация у нас). Байты мимо приложения.
 *
 * Условия политики — всё, что хранилище проверит само, до нашей финализации:
 *   * точный ключ (его придумал сервер; браузер не выберет другой — `createPresignedPost`
 *     кладёт `{ key }` в условия сам);
 *   * размер от 1 байта до `maxBytes` — больше хранилище не примет вовсе;
 *   * `Content-Type` ровно тот, что выбрал сервер, — объект не отдастся потом `text/html`.
 */
export async function presignPost(
  key: string,
  contentType: string,
  maxBytes: number,
  expiresSec: number,
): Promise<{ url: string; fields: Record<string, string> }> {
  const { s3, bucket, prefix } = await client('uploads')
  return createPresignedPost(s3, {
    Bucket: bucket,
    Key: withPrefix(prefix, key),
    Conditions: [
      ['content-length-range', 1, maxBytes],
      ['eq', '$Content-Type', contentType],
    ],
    Fields: { 'Content-Type': contentType },
    Expires: expiresSec,
  })
}

const isNotFound = (e: unknown): boolean => {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } }
  return err?.name === 'NotFound' || err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404
}

/** Размер объекта в байтах; null — объекта нет. Прочие сбои хранилища пробрасываются. */
export async function headObject(key: string): Promise<number | null> {
  const { s3, bucket, prefix } = await client('uploads')
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: withPrefix(prefix, key) }))
    return head.ContentLength ?? 0
  } catch (e) {
    if (isNotFound(e)) return null
    throw e
  }
}

/** Первые `n` байт объекта (Range-запрос) — для проверки сигнатуры без скачивания целиком. */
export async function readHead(key: string, n: number): Promise<Buffer> {
  const { s3, bucket, prefix } = await client('uploads')
  const res = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: withPrefix(prefix, key), Range: `bytes=0-${Math.max(0, n - 1)}` }),
  )
  const bytes = (await res.Body?.transformToByteArray()) ?? new Uint8Array()
  return Buffer.from(bytes)
}

/**
 * `Content-Disposition` с исходным именем: ASCII-запасное в `filename` и точное в
 * `filename*` (RFC 6266 / RFC 5987) — кириллица в имени иначе ломает заголовок.
 */
export function contentDisposition(disposition: 'inline' | 'attachment', filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_') || 'file'
  // encodeURIComponent оставляет ' ( ) * — в ext-value RFC 5987 они не законны.
  const exact = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${exact}`
}

/** Подписанная ссылка на чтение объекта с заданными заголовками ответа. */
export async function signedGetUrl(
  key: string,
  opts: { disposition: 'inline' | 'attachment'; filename: string; contentType: string; expiresSec: number },
): Promise<string> {
  const { s3, bucket, prefix } = await client('uploads')
  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: withPrefix(prefix, key),
    ResponseContentDisposition: contentDisposition(opts.disposition, opts.filename),
    ResponseContentType: opts.contentType,
  })
  return getSignedUrl(s3, cmd, { expiresIn: opts.expiresSec })
}

/** CORS-правила бакета загрузок; нет конфигурации — пустой список. */
export async function getUploadsCors(): Promise<CORSRule[]> {
  const { s3, bucket } = await client('uploads')
  try {
    const res = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }))
    return res.CORSRules ?? []
  } catch (e) {
    const err = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } }
    if (err?.name === 'NoSuchCORSConfiguration' || err?.Code === 'NoSuchCORSConfiguration' || err?.$metadata?.httpStatusCode === 404) return []
    throw e
  }
}

/** Записать CORS-правила бакета загрузок (целиком — S3 иначе не умеет). */
export async function putUploadsCors(rules: CORSRule[]): Promise<void> {
  const { s3, bucket } = await client('uploads')
  await s3.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: rules } }))
}
