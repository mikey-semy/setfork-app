import 'server-only'
import { tr } from '@/shared/i18n'
import { getFeed, getTemplateDetail } from '@/features/library/queries'

// Инструменты MCP работают от имени пользователя токена (userId).
// Приватность соблюдается: getFeed/visibleFilter уже фильтруют по viewerId,
// get_list проверяет доступ явно. Контент отдаём в EN (locale-JSON, tr с фолбэком).

export async function mcpSearch(userId: string, query: string, limit: number) {
  const feed = await getFeed({ q: query }, userId)
  return {
    query,
    count: Math.min(feed.length, limit),
    results: feed.slice(0, limit).map((f) => ({
      ref: `${f.ownerHandle}/${f.slug}`,
      title: tr(f.title, 'en'),
      desc: tr(f.desc, 'en'),
      tags: f.tags,
      version: f.version,
      stars: f.starsCount,
      verified: f.verified,
    })),
  }
}

export async function mcpGetList(userId: string, handle: string, slug: string) {
  const detail = await getTemplateDetail(handle, slug)
  if (!detail) return null
  const { tpl, currentVersion, steps } = detail
  const isOwner = tpl.ownerId === userId
  // Те же гарантии, что и на странице: чужое приватное/черновик/скрытое не отдаём.
  if (tpl.visibility === 'private' && !isOwner) return null
  if (tpl.status === 'draft' && !isOwner) return null
  if (tpl.moderation !== 'active' && !isOwner) return null

  return {
    ref: `${handle}/${slug}`,
    title: tr(tpl.title, 'en'),
    desc: tr(tpl.desc, 'en'),
    tags: tpl.tags,
    ordered: tpl.ordered,
    version: currentVersion?.version ?? tpl.currentVersion,
    verified: tpl.verified,
    steps: steps.map((s) => ({
      n: s.n,
      title: tr(s.title, 'en'),
      desc: tr(s.desc, 'en'),
      command: s.command || undefined,
      subtasks: s.subtasks.map((x) => tr(x, 'en')).filter(Boolean),
      refs: s.refs.map((r) => ({ label: tr(r.label, 'en'), url: r.url })).filter((r) => r.label),
    })),
  }
}
