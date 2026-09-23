import { getSession } from '@/shared/auth/session'
import { beginUpload, UPLOAD_ERROR_STATUS, uploadRateLimit } from '@/shared/media/direct-upload'
import { tooMany } from '@/shared/rate-limit'
import { crossOriginBlock } from '@/shared/csrf'

// Начало прямой загрузки в S3 (вложение, свой клип): тело — маленький JSON
// { kind, name, size }, ответ — { id, url, fields } подписанной POST-политики.
// Сам файл сюда не приходит. Логика — в shared/media/direct-upload.
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const blocked = crossOriginBlock(req)
  if (blocked) return blocked
  const session = await getSession()
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const rl = await uploadRateLimit(session.userId)
  if (!rl.ok) return tooMany(rl)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const res = await beginUpload(session.userId, { kind: body?.kind, name: body?.name, size: body?.size })
  if ('error' in res) return Response.json(res, { status: UPLOAD_ERROR_STATUS[res.error] })
  return Response.json(res)
}
