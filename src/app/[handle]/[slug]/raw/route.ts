import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { getTemplateDetail } from '@/features/library/queries'
import { toShellScript, type ExportList } from '@/features/library/export'

// GET /{handle}/{slug}/raw — список как исполняемый bash-скрипт (аналог gist raw).
//   curl -fsSL https://host/{owner}/{slug}/raw | bash
export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const [lang, detail, viewer] = await Promise.all([getLang(), getTemplateDetail(handle, slug), getSession()])
  if (!detail) return new Response('# Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

  const { tpl, currentVersion, steps } = detail
  const isOwner = viewer?.userId === tpl.ownerId
  const isOwnerOrAdmin = isOwner || isAdminHandle(viewer?.handle)
  // Те же гарантии приватности, что и на странице списка/export — не отдаём чужое.
  const denied =
    (tpl.visibility === 'private' && !isOwner) ||
    (tpl.status === 'draft' && !isOwner) ||
    (tpl.moderation !== 'active' && !isOwnerOrAdmin)
  if (denied) return new Response('# Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

  const u = new URL(req.url)
  const rawUrl = `${u.origin}${u.pathname}`
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

  return new Response(toShellScript(list, lang, rawUrl), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `inline; filename="${slug}.sh"`,
    },
  })
}
