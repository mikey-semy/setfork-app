import 'server-only'
import { NextResponse } from 'next/server'
import { getLandingOverrides, landingApiContent } from '@/shared/settings/landing'
import { getFeed } from '@/features/library/queries'

// Публичный контракт для маркетинг-лендинга (проект setfork-about, ISR):
//   - content: ТОЛЬКО правки из админки (`shared/settings/landing`) — строки поверх словаря
//     лендинга; без правок — пусто, и лендинг рисует свой словарь целиком;
//   - featured: ЖИВЫЕ топ-списки (реальные данные, не дубль руками).
// Картинки hero и подмешанных счётчиков здесь больше нет: новый лендинг без картинки, а
// своя полоса доверия у него в словаре — плитка отсюда её бы заменила.
// Кросс-ориджин: лендинг на другом домене — отдаём CORS (данные публичные).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic' // всегда свежее; лендинг сам кэширует через ISR

export async function GET() {
  const [overrides, top] = await Promise.all([getLandingOverrides(), getFeed({ sort: 'mostStarred' }).catch(() => [])])

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
    { content: landingApiContent(overrides), featured, generatedAt: new Date().toISOString() },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        // Час: лендинг не биржа, а топ по базе не должен стоить запроса на каждый показ.
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=600',
      },
    },
  )
}

// «1234» → «1.2k» для карточек (как в дизайне лендинга).
function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}
