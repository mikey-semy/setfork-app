import { getLang } from '@/shared/i18n/server'
import { requireViewableDetail } from '@/features/library/guard'
import { toHtml, toMarkdown, toExportList } from '@/features/library/export'
import { cacheHeaders, noStoreHeaders } from '@/shared/http/cache'

// GET /{handle}/{slug}/export?format=md|html — скачивание списка.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ handle: string; slug: string }> },
) {
  const { handle, slug } = await params
  const format = new URL(req.url).searchParams.get('format') === 'html' ? 'html' : 'md'
  const [lang, detail] = await Promise.all([getLang(), requireViewableDetail(handle, slug)])
  if (!detail) return new Response('Not found', { status: 404, headers: noStoreHeaders() })

  const list = toExportList(detail)

  const body = format === 'html' ? toHtml(list, lang) : toMarkdown(list, lang)
  const mime = format === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8'
  return new Response(body, {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${slug}.${format}"`,
      // Скачивание идёт ПО СЕССИИ и на любом языке зрителя: приватный список тут
      // такой же законный гость, как публичный. Своей политики у ответа не было
      // вовсе — значит её выбирал прокси или браузер. Общий кеш здесь не нужен:
      // выгода нулевая, а цена ошибки — чужой файл из общей папки.
      ...cacheHeaders({ shared: false }),
    },
  })
}
