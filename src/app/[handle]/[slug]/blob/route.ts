import { gitCore } from '@/features/git/core'
import { requireViewableDetail } from '@/features/library/guard'
import { cacheHeaders } from '@/shared/http/cache'
import { problem, problemListNotFound } from '@/shared/http/problem'
import { highlightLines, resolveHighlightLang } from '@/shared/ui/highlight-code'
import { binaryAllowedAt, lfsPointerOf } from '@/core/domain/lfs-pointer'
import { getAsset } from '@/shared/media/asset-store'

/**
 * GET /{handle}/{slug}/blob?path=scripts/run.sh[&v=N] — один файл автора (ADR-0028): текст —
 * текстом, двоичный из `assets/` — скачиванием (байты из хранилища по хешу).
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
 *
 * Отказы — Problem Details, как у прочих машинных адресов списка (openapi.json). «Файла
 * нет» и «ядро не ответило» — разные ответы: на первый повтор бесполезен, на второй — нужен.
 */
export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const url = new URL(req.url)
  const path = url.searchParams.get('path') ?? ''
  const detail = await requireViewableDetail(handle, slug)
  if (!detail) return problemListNotFound()
  if (!path) return problem(400, 'path_required', { detail: 'Name the file: ?path=scripts/run.sh' })

  const asked = Number(url.searchParams.get('v'))
  const version = Number.isInteger(asked) && asked > 0 ? asked : detail.tpl.currentVersion
  const files = await gitCore.authoredFiles({ owner: handle, slug }, version).catch(() => undefined)
  if (files === undefined) return problem(503, 'core_unavailable', { detail: 'The files could not be read right now; try again.' })
  const file = files?.find((f) => f.path === path)
  if (!file) return problem(404, 'file_not_found', { detail: `No file ${path} in version ${version}.` })

  const name = path.slice(path.lastIndexOf('/') + 1)
  // Двоичный файл лежит в дереве указателем: отдаём его байты из хранилища — СКАЧИВАНИЕМ и
  // как `application/octet-stream`, чтобы браузер ничего из него не исполнял и не показывал.
  const pointer = binaryAllowedAt(path) ? lfsPointerOf(file.content) : null
  if (pointer) {
    const bytes = await getAsset(pointer).catch(() => undefined)
    if (bytes === undefined) return problem(503, 'storage_unavailable', { detail: 'The file could not be read from storage right now; try again.' })
    if (!bytes) return problem(404, 'file_not_found', { detail: `The bytes of ${path} are missing from storage.` })
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        ...cacheHeaders({ shared: false }),
      },
    })
  }
  // ?format=lines — для просмотра на странице: строки уже подсвечены НА СЕРВЕРЕ, как у
  // CodeCard (highlight.js в бандл клиента не попадает). Токены — текст, клиент кладёт
  // их текстом, не HTML, так что `text/plain`-защита выше тут не нужна.
  if (url.searchParams.get('format') === 'lines') {
    const code = new TextDecoder().decode(file.content)
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
    const language = resolveHighlightLang(ext)
    return Response.json(
      { code, language, lines: highlightLines(code, ext) },
      { headers: { 'X-Content-Type-Options': 'nosniff', ...cacheHeaders({ shared: false }) } },
    )
  }
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
