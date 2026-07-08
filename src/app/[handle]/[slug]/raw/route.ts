import { getLang } from '@/shared/i18n/server'
import { requireViewableDetail } from '@/features/library/guard'
import { dialectExt, dialectMime, normalizeDialect, toRunnableScript, toExportList } from '@/features/library/export'

// GET /{handle}/{slug}/raw[?lang=sh|ps1|py] — список как исполняемый скрипт (gist-стиль).
//   curl -fsSL https://host/{owner}/{slug}/raw | bash
//   irm "https://host/{owner}/{slug}/raw?lang=ps1" | iex   (PowerShell)
export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const [lang, detail] = await Promise.all([getLang(), requireViewableDetail(handle, slug)])
  if (!detail) return new Response('# Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

  const { tpl, currentVersion, steps } = detail

  const u = new URL(req.url)
  const rawUrl = `${u.origin}${u.pathname}`
  const dialect = normalizeDialect(u.searchParams.get('lang'))
  const list = toExportList(detail)

  return new Response(toRunnableScript(list, lang, rawUrl, dialect), {
    headers: {
      'Content-Type': dialectMime(dialect),
      'Content-Disposition': `inline; filename="${slug}.${dialectExt(dialect)}"`,
    },
  })
}
