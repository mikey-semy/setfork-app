import { getLang } from '@/shared/i18n/server'
import { requireViewableDetail } from '@/features/library/guard'
import { toHtml, toMarkdown, type ExportList } from '@/features/library/export'

// GET /{handle}/{slug}/export?format=md|html — скачивание списка.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ handle: string; slug: string }> },
) {
  const { handle, slug } = await params
  const format = new URL(req.url).searchParams.get('format') === 'html' ? 'html' : 'md'
  const [lang, detail] = await Promise.all([getLang(), requireViewableDetail(handle, slug)])
  if (!detail) return new Response('Not found', { status: 404 })

  const { tpl, currentVersion, steps } = detail

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

  const body = format === 'html' ? toHtml(list, lang) : toMarkdown(list, lang)
  const mime = format === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8'
  return new Response(body, {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${slug}.${format}"`,
    },
  })
}
