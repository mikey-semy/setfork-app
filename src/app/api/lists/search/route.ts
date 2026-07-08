import { getLang } from '@/shared/i18n/server'
import { tr } from '@/shared/i18n'
import { searchListSuggestions } from '@/features/library/queries'
import { rateLimit, tooMany } from '@/shared/rate-limit'

// Публичные подсказки списков для автокомплита в шапке (переход прямо на список).
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon'
  const rl = await rateLimit(`lsearch:ip:${ip}`, 60, 60_000)
  if (!rl.ok) return tooMany(rl)
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (!q) return Response.json([])
  const [lang, rows] = await Promise.all([getLang(), searchListSuggestions(q, 6)])
  return Response.json(rows.map((r) => ({ handle: r.handle, slug: r.slug, title: tr(r.title, lang) })))
}
