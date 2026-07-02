import 'server-only'

// Конфиг медиа-системы (S3-совместимое хранилище + imgproxy).
// Локально: MinIO + imgproxy (docker compose). Прод: Selectel S3 + CDN —
// достаточно поменять S3_ENDPOINT/регион/бакет/креды и CDN_URL в .env.
const strip = (s: string | undefined) => (s || '').replace(/\/+$/, '')

export const mediaConfig = {
  s3: {
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET || '',
    accessKey: process.env.S3_ACCESS_KEY || '',
    secretKey: process.env.S3_SECRET_KEY || '',
    prefix: (process.env.S3_PATH_PREFIX || '').replace(/^\/+|\/+$/g, ''),
  },
  imgproxy: {
    url: strip(process.env.IMGPROXY_URL),
    key: process.env.IMGPROXY_KEY || '',
    salt: process.env.IMGPROXY_SALT || '',
    enabled: process.env.MEDIA_USE_IMGPROXY === 'true',
  },
  // CDN перед imgproxy (прод). Пусто — ходим напрямую в imgproxy.
  cdnUrl: strip(process.env.CDN_URL),
}

export function isS3Configured(): boolean {
  const s = mediaConfig.s3
  return Boolean(s.endpoint && s.bucket && s.accessKey && s.secretKey)
}
