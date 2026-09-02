import 'server-only'
import { NextResponse } from 'next/server'
import { getLandingContent } from '@/shared/settings/landing'
import { imageUrl } from '@/shared/media'
import { getFeed } from '@/features/library/queries'
import { landingCounts, statsFrom } from '@/features/landing/stats'

// Публичный контракт для маркетинг-лендинга (проект setfork-about, ISR):
//   - content: редактируемый копирайт (двуязычный) из app_settings (админка);
//   - featured: ЖИВЫЕ топ-списки (реальные данные, не дубль руками).
// Кросс-ориджин: лендинг на другом домене — отдаём CORS (данные публичные).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic' // всегда свежее; лендинг сам кэширует через ISR

export async function GET() {
  const [content, top, counts] = await Promise.all([
    getLandingContent(),
    getFeed({ sort: 'mostStarred' }).catch(() => []),
    landingCounts().catch(() => ({ lists: 0, contributions: 0, makers: 0 })),
  ])

  // ⚠️ СЧИТАЕМ, А НЕ ПОВТОРЯЕМ. Числа на витрине были вписаны руками и не совпадали с
  // корпусом ни в одну сторону («12k+» при 24 публичных списках). Теперь они приходят
  // из базы, а при малом корпусе плиток с числами нет совсем: пустой слот честнее
  // выдуманного. Плитка без числа («MCP») остаётся — она ничего не обещает счётом.
  for (const lang of ['en', 'ru'] as const) {
    const labels: [string, string, string] =
      lang === 'en'
        ? ['public lists', 'contributions', 'makers']
        : ['публичных списков', 'улучшений', 'авторов']
    content[lang].stats = [...statsFrom(counts, labels), ...content[lang].stats.filter((s) => !/^\d/.test(s.num))]
  }

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
    { headers: { 'Access-Control-Allow-Origin': '*', // Час: лендинг не биржа, а счёт по базе не должен стоить запроса на каждый показ.
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=600' } },
  )
}

// «1234» → «1.2k» для карточек (как в дизайне лендинга).
function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}
