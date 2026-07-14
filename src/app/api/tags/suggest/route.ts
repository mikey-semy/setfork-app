import { searchTags } from '@/features/tags/queries'

// Автокомплит тегов из реестра (для TagInput). Публично — теги не приватны.
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q') ?? ''
  const rows = await searchTags(q, 8)
  return Response.json(
    rows.map((r) => ({ slug: r.slug, curated: r.curated, usageCount: r.usageCount })),
    { headers: { 'cache-control': 'public, max-age=60' } },
  )
}
