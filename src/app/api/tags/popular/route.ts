import { getPopularTags } from '@/features/library/queries'

// Публичные популярные теги — для автокомплита `tag:` в поле поиска (шапка).
export const runtime = 'nodejs'

export async function GET() {
  const tags = await getPopularTags(60)
  return Response.json(tags, { headers: { 'cache-control': 'public, max-age=120' } })
}
