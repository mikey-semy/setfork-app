import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { getTemplateDetail } from '@/features/library/queries'
import { canViewList } from '@/features/library/access'
import { dialectExt, dialectMime, normalizeDialect, toRunnableScript, type ExportList } from '@/features/library/export'

// GET /{handle}/{slug}/raw[?lang=sh|ps1|py] — список как исполняемый скрипт (gist-стиль).
//   curl -fsSL https://host/{owner}/{slug}/raw | bash
//   irm "https://host/{owner}/{slug}/raw?lang=ps1" | iex   (PowerShell)
export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const [lang, detail, viewer] = await Promise.all([getLang(), getTemplateDetail(handle, slug), getSession()])
  if (!detail) return new Response('# Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

  const { tpl, currentVersion, steps } = detail
  // Единый предикат приватности (тот же, что на странице списка/export).
  if (!canViewList(tpl, { isOwner: viewer?.userId === tpl.ownerId, isAdmin: isAdminHandle(viewer?.handle) }))
    return new Response('# Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

  const u = new URL(req.url)
  const rawUrl = `${u.origin}${u.pathname}`
  const dialect = normalizeDialect(u.searchParams.get('lang'))
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

  return new Response(toRunnableScript(list, lang, rawUrl, dialect), {
    headers: {
      'Content-Type': dialectMime(dialect),
      'Content-Disposition': `inline; filename="${slug}.${dialectExt(dialect)}"`,
    },
  })
}
