import { getLang } from '@/shared/i18n/server'
import { requireViewableDetail } from '@/features/library/guard'
import { toHtml, toMarkdown, toExportList } from '@/features/library/export'
import { cacheHeaders, noStoreHeaders } from '@/shared/http/cache'
import { versionShaMap } from '@/features/library/version-sha'
import { listStore } from '@/features/library/list-store'

// GET /{handle}/{slug}/export?format=md|html — скачивание списка.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ handle: string; slug: string }> },
) {
  const { handle, slug } = await params
  const format = new URL(req.url).searchParams.get('format') === 'html' ? 'html' : 'md'
  const [lang, detail] = await Promise.all([getLang(), requireViewableDetail(handle, slug)])
  if (!detail) return new Response('Not found', { status: 404, headers: noStoreHeaders() })

  // Подпись версии — из ядра, одним вызовом и мягко: отказ ядра не должен лишать
  // человека файла. Нет подписи — в шапке её просто не будет (см. toMarkdown).
  //
  // ⚠️ Спрашиваем ТОЛЬКО для markdown: `toHtml` подпись не читает, и для html это был
  // запрос, результат которого выбрасывается. И не через `listStore` — фасад читает
  // Postgres, где SHA нет вовсе (см. `versionShaMap`).
  const wantSha = format === 'md'
  const shaMap = wantSha ? await versionShaMap(detail.tpl.id) : null
  const sha = shaMap?.get(detail.currentVersion?.version ?? detail.tpl.currentVersion) ?? null
  const list = toExportList(detail, sha)

  const body = format === 'html' ? toHtml(list, lang) : toMarkdown(list, lang)
  const mime = format === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8'
  return new Response(body, {
    headers: {
      'Content-Type': mime,
      // ⚠️ `inline` для markdown: этот же маршрут обслуживает адрес `/{handle}/{slug}.md`,
      // а `llms.txt` обещает агентам «допишите `.md` к адресу». С `attachment` браузер и
      // читающий клиент СКАЧИВАЮТ файл вместо того, чтобы показать, — обещание не
      // исполняется. Для `html` (кнопка «скачать») поведение прежнее.
      'Content-Disposition':
        format === 'md' ? `inline; filename="${slug}.md"` : `attachment; filename="${slug}.${format}"`,
      // Скачивание идёт ПО СЕССИИ и на любом языке зрителя: приватный список тут
      // такой же законный гость, как публичный. Своей политики у ответа не было
      // вовсе — значит её выбирал прокси или браузер. Общий кеш здесь не нужен:
      // выгода нулевая, а цена ошибки — чужой файл из общей папки.
      ...cacheHeaders({ shared: false }),
    },
  })
}
