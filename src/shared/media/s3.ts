import 'server-only'
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getMediaSettings } from '@/shared/settings/media'

async function client(): Promise<{ s3: S3Client; bucket: string; prefix: string }> {
  const s = await getMediaSettings()
  const s3 = new S3Client({
    endpoint: s.s3Endpoint,
    region: s.s3Region,
    forcePathStyle: true, // Selectel/MinIO — path-style (бакет в пути, не в поддомене)
    credentials: { accessKeyId: s.s3AccessKey, secretAccessKey: s.s3SecretKey },
  })
  return { s3, bucket: s.s3Bucket, prefix: s.s3Prefix }
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
