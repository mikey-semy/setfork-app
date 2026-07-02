import 'server-only'
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { mediaConfig } from './config'

let cached: S3Client | null = null
function client(): S3Client {
  if (cached) return cached
  const { endpoint, region, accessKey, secretKey } = mediaConfig.s3
  cached = new S3Client({
    endpoint,
    region,
    forcePathStyle: true, // Selectel/MinIO — path-style (бакет в пути, не в поддомене)
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  })
  return cached
}

function prefixed(key: string): string {
  const p = mediaConfig.s3.prefix
  return p ? `${p}/${key}` : key
}

/** Загрузка объекта. Возвращает storage_key (без префикса окружения). */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<string> {
  await client().send(
    new PutObjectCommand({
      Bucket: mediaConfig.s3.bucket,
      Key: prefixed(key),
      Body: body,
      ContentType: contentType,
      CacheControl: 'max-age=31536000', // 1 год — оригиналы неизменяемы (uuid в имени)
    }),
  )
  return key
}

/** Удаляет все объекты под префиксом (напр. avatars/{userId}/). */
export async function deleteByPrefix(keyPrefix: string): Promise<void> {
  const listed = await client().send(
    new ListObjectsV2Command({ Bucket: mediaConfig.s3.bucket, Prefix: prefixed(keyPrefix) }),
  )
  const objects = (listed.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((o) => o.Key)
  if (objects.length === 0) return
  await client().send(
    new DeleteObjectsCommand({ Bucket: mediaConfig.s3.bucket, Delete: { Objects: objects } }),
  )
}
