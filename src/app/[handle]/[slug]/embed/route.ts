import { getLang } from '@/shared/i18n/server'
import { getTemplateDetail } from '@/features/library/queries'
import { toHtml, type ExportList } from '@/features/library/export'

// GET /{handle}/{slug}/embed — самодостаточный HTML списка для вставки в <iframe>.
// Только публичные опубликованные списки (embed идёт на внешние сайты).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const [lang, detail] = await Promise.all([getLang(), getTemplateDetail(handle, slug)])
  if (!detail) return new Response('Not found', { status: 404 })

  const { tpl, currentVersion, steps } = detail
  if (tpl.visibility !== 'public' || tpl.status !== 'published' || tpl.moderation !== 'active')
    return new Response('Not found', { status: 404 })

  const list: ExportList = {
    title: tpl.title,
    desc: tpl.desc,
    tags: tpl.tags,
    ordered: tpl.ordered,
    version: currentVersion?.version ?? tpl.currentVersion,
    ownerHandle: tpl.owner.handle,
    slug: tpl.slug,
    steps: steps.map((s) => ({
      n: s.n,
      title: s.title,
      desc: s.desc,
      command: s.command,
      level: s.level,
      why: s.why,
      subtasks: s.subtasks,
      refs: s.refs,
    })),
  }

  const origin = new URL(req.url).origin
  const footer = `<div style="text-align:center;margin:20px 0 8px;font:12px/1.4 system-ui,sans-serif"><a href="${origin}/${handle}/${slug}" target="_blank" rel="noopener" style="color:#2563eb;text-decoration:none">↗ SetFork · ${handle}/${slug}</a></div>`
  let html = toHtml(list, lang)
  html = html.includes('</body>') ? html.replace('</body>', `${footer}</body>`) : html + footer

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Content-Security-Policy': 'frame-ancestors *', // разрешаем вставку на любые сайты
    },
  })
}
