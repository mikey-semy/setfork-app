import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://setfork.com'

// Явно разрешаем обход — favicon в результатах поиска показывается только для
// индексируемой главной. Приватные/служебные пути закрываем.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/settings', '/runs'] },
    host: SITE_URL,
  }
}
