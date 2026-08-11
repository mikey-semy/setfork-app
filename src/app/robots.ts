import type { MetadataRoute } from 'next'
import { SITE_ORIGIN } from '@/shared/site'

const SITE_URL = SITE_ORIGIN

// Явно разрешаем обход — favicon в результатах поиска показывается только для
// индексируемой главной. Приватные/служебные пути закрываем.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/settings', '/runs'] },
    host: SITE_URL,
  }
}
