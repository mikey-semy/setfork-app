import { SITE_ORIGIN } from '@/shared/site'

/**
 * robots.txt — своим маршрутом, а не `robots.ts` (MetadataRoute.Robots): генератор Next
 * не умеет свои директивы, а здесь нужна `Content-Signal`.
 *
 * CONTENT SIGNALS (contentsignals.org, политика Cloudflare под CC0; в IETF — группа AIPREF):
 * как можно использовать содержимое. Строка стоит ВНУТРИ группы `User-Agent`, перед
 * правилами, — так в примере первоисточника.
 *  - `search=yes` — поисковый индекс и выдача нужны;
 *  - `ai-input=yes` — подстановка в живой ответ модели: пусть нейроответы цитируют списки;
 *  - `ai-train=no` — ДО РЕШЕНИЯ L1 (лицензия контента): права на обучение по чужим
 *    спискам без лицензии мы раздавать не можем. Пересмотреть вместе с L1.
 * Сигнал — просьба, а не запрет: честные обходчики ей следуют, остальные нет.
 *
 * ⚠️ Директивы `Host` здесь НЕТ намеренно. Яндекс отменил её в марте 2018: склейка
 * зеркал делается 301-редиректом и разделом «Переезд сайта» в Вебмастере, а строка
 * в robots.txt не значит ничего.
 */
export const CONTENT_SIGNAL = 'search=yes, ai-input=yes, ai-train=no'

// Явно разрешаем обход — favicon в результатах поиска показывается только для
// индексируемой главной. Приватные/служебные пути закрываем. `/healthz` — машинная
// проба, а не страница: прежний адрес закрывался префиксом `/api/`, новый в него не
// попадает — значит закрывается явно.
const DISALLOW = ['/api/', '/healthz', '/settings', '/runs']

export const dynamic = 'force-static'

export function GET() {
  const body = [
    'User-Agent: *',
    `Content-Signal: ${CONTENT_SIGNAL}`,
    'Allow: /',
    ...DISALLOW.map((p) => `Disallow: ${p}`),
    '',
    // Без этой строки карта сайта существует, но никем не запрашивается: обходчик
    // узнаёт о ней либо отсюда, либо из ручной отправки в консоли вебмастера.
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    '',
  ].join('\n')
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
