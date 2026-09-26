import { getSession } from '@/shared/auth/session'
import { imageUrl, uploadImageFile } from '@/shared/media'
import { uploadRateLimit } from '@/shared/media/direct-upload'
import { tooMany } from '@/shared/rate-limit'
import { crossOriginBlock } from '@/shared/csrf'

// Загрузка КАРТИНКИ из markdown-редактора (issues/комментарии). Только для залогиненных.
// Картинка → { url, kind:'image' } (S3→imgproxy / диск). Вложения сюда больше не идут:
// они грузятся напрямую в S3 (/api/uploads, shared/media/direct-upload) — через
// приложение 25 МБ не проходят, а диск контейнера не переживает выкатку.
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const blocked = crossOriginBlock(req)
  if (blocked) return blocked
  const session = await getSession()
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const rl = await uploadRateLimit(session.userId)
  if (!rl.ok) return tooMany(rl)

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'no file' }, { status: 400 })
  // Не картинка — код, а не текст: клиент переводит его сам (upload.error.bad_type).
  if (!file.type.startsWith('image/')) return Response.json({ error: 'bad_type' }, { status: 415 })

  try {
    const ref = await uploadImageFile('issues', file)
    const url = (await imageUrl(ref, 'rs:fit:1600:1600')) ?? ref
    return Response.json({ url, kind: 'image', name: file.name })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
}
