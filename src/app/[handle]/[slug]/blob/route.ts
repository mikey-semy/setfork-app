import { gitCore } from '@/features/git/core'
import { requireViewableDetail } from '@/features/library/guard'
import { cacheHeaders, noStoreHeaders } from '@/shared/http/cache'

/**
 * GET /{handle}/{slug}/blob?path=scripts/run.sh[&v=N] — один файл автора (ADR-0028) текстом.
 *
 * Проводник файлов на странице списка открывает их отсюда по щелчку, а не везёт все в
 * страницу: набор бывает до мегабайта.
 *
 * Путь — ПАРАМЕТРОМ, а не хвостом адреса: `…/blob/references/guide.md` кончается на `.md`,
 * и мидлвара переписала бы его на экспорт списка в markdown.
 *
 * ⚠️ Отдаём ТОЛЬКО как `text/plain` + `nosniff` + `sandbox`: файл пишет автор списка, и
 * `assets/page.html`, отданный как html, исполнился бы в браузере зрителя на нашем домене.
 * Видимость — та же, что у страницы и экспорта (`requireViewableDetail`).
 */
export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const url = new URL(req.url)
  const path = url.searchParams.get('path') ?? ''
  const detail = await requireViewableDetail(handle, slug)
  if (!detail || !path) return new Response('Not found', { status: 404, headers: noStoreHeaders() })

  const asked = Number(url.searchParams.get('v'))
  const version = Number.isInteger(asked) && asked > 0 ? asked : detail.tpl.currentVersion
  const files = await gitCore.authoredFiles({ owner: handle, slug }, version).catch(() => null)
  const file = files?.find((f) => f.path === path)
  if (!file) return new Response('Not found', { status: 404, headers: noStoreHeaders() })

  const name = path.slice(path.lastIndexOf('/') + 1)
  return new Response(file.content as unknown as BodyInit, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      // Как у экспорта: ответ зависит от права зрителя, общему кешу он не нужен.
      ...cacheHeaders({ shared: false }),
    },
  })
}
