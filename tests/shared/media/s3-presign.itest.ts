import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Подписанная POST-политика — настоящая (`@aws-sdk/s3-presigned-post` считает её
 * локально, в сеть не ходит). Проверяем то, что хранилище будет исполнять за нас:
 * точный ключ с префиксом окружения, диапазон размера и тип.
 *
 * Итест, а не юнит: настройки медиа читаются из БД (app_settings) с фолбэком на env.
 */
const { clearMediaCache } = await import('@/shared/settings/media')
const { presignPost } = await import('@/shared/media/s3')

const ENV = { S3_ENDPOINT: 'https://s3.test', S3_BUCKET: 'bkt', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 's', S3_PATH_PREFIX: 'stage' }
const saved: Record<string, string | undefined> = {}
beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k]
    process.env[k] = v
  }
  clearMediaCache()
})
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  clearMediaCache()
})

describe('presignPost', () => {
  it('свой бакет загрузок + vHosted — адрес виртуального хоста, основной бакет не при чём', async () => {
    Object.assign(process.env, { S3_UPLOADS_BUCKET: 'setfork-uploads', S3_UPLOADS_VHOST: 'true' })
    clearMediaCache()
    try {
      const post = await presignPost('files/u/k.pdf', 'application/octet-stream', 1000, 600)
      expect(post.url).toBe('https://setfork-uploads.s3.test/')
      expect(post.fields.bucket).toBe('setfork-uploads')
    } finally {
      delete process.env.S3_UPLOADS_BUCKET
      delete process.env.S3_UPLOADS_VHOST
      clearMediaCache()
    }
  })

  it('политика держит ключ (с префиксом окружения), размер 1..max и тип', async () => {
    const post = await presignPost('files/u/k.pdf', 'application/octet-stream', 1000, 600)
    expect(post.url).toBe('https://s3.test/bkt')
    expect(post.fields.key).toBe('stage/files/u/k.pdf')
    expect(post.fields['Content-Type']).toBe('application/octet-stream')
    const policy = JSON.parse(Buffer.from(post.fields.Policy, 'base64').toString('utf8')) as { conditions: unknown[]; expiration: string }
    expect(policy.conditions).toContainEqual({ key: 'stage/files/u/k.pdf' })
    expect(policy.conditions).toContainEqual(['content-length-range', 1, 1000])
    expect(policy.conditions).toContainEqual(['eq', '$Content-Type', 'application/octet-stream'])
    const ttl = new Date(policy.expiration).getTime() - Date.now()
    expect(ttl).toBeGreaterThan(590_000)
    expect(ttl).toBeLessThanOrEqual(600_000)
  })
})
