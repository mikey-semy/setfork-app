import { getLang } from '@/shared/i18n/server'
import { getTemplateDetail } from '@/features/library/queries'
import { embedHtml, type ExportList } from '@/features/library/export'

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
      type: s.type,
      content: s.content,
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
  const html = embedHtml(list, lang, `${origin}/${handle}/${slug}`)

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Короткий кэш: сокращает окно, в которое CDN отдаёт embed уже снятого модерацией списка.
      'Cache-Control': 'public, max-age=60',
      'Content-Security-Policy': 'frame-ancestors *', // разрешаем вставку на любые сайты
    },
  })
}
