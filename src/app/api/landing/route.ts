import 'server-only'
import { NextResponse } from 'next/server'
import { getLandingContent } from '@/shared/settings/landing'
import { imageUrl } from '@/shared/media'
import { getFeed } from '@/features/library/queries'

// Публичный контракт для маркетинг-лендинга (проект setfork-about, ISR):
//   - content: редактируемый копирайт (двуязычный) из app_settings (админка);
//   - featured: ЖИВЫЕ топ-списки (реальные данные, не дубль руками).
// Кросс-ориджин: лендинг на другом домене — отдаём CORS (данные публичные).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic' // всегда свежее; лендинг сам кэширует через ISR

export async function GET() {
  const [content, top] = await Promise.all([getLandingContent(), getFeed({ sort: 'mostStarred' }).catch(() => [])])

  // heroImage хранится как storage_key — резолвим в подписанный URL (лендинг сам не подпишет).
  if (content.heroImage) content.heroImage = (await imageUrl(content.heroImage, 'rs:fit:1536:0')) ?? undefined

  // Лёгкая проекция карточек (title/desc — LocaleText, лендинг резолвит по языку).
  const featured = top.slice(0, 6).map((l) => ({
    owner: `@${l.ownerHandle}`,
    title: l.title,
    desc: l.desc,
    tags: (l.tags ?? []).slice(0, 2),
    stars: fmt(l.starsCount),
    forks: fmt(l.forksCount),
  }))

  return NextResponse.json(
    { content, featured, generatedAt: new Date().toISOString() },
    { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' } },
  )
}

// «1234» → «1.2k» для карточек (как в дизайне лендинга).
function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}
