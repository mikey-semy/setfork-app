import { getSession } from '@/shared/auth/session'
import { completeUpload, UPLOAD_ERROR_STATUS } from '@/shared/media/direct-upload'
import { crossOriginBlock } from '@/shared/csrf'

// Финализация прямой загрузки: объект в бакете проверен → { url: '/media/…', name }.
// Лимит частоты не нужен: финализировать можно только СВОЮ начатую загрузку, а
// начало уже посчитано общим лимитом загрузок (uploadRateLimit в /api/uploads).
export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = crossOriginBlock(req)
  if (blocked) return blocked
  const session = await getSession()
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const res = await completeUpload(session.userId, id)
  if ('error' in res) return Response.json(res, { status: UPLOAD_ERROR_STATUS[res.error] })
  return Response.json(res)
}
