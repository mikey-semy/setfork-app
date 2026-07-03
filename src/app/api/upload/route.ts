import { getSession } from '@/shared/auth/session'
import { imageUrl, uploadImageFile } from '@/shared/media'

// Загрузка картинки из markdown-редактора (issues/комментарии). Только для залогиненных.
// Возвращает { url } — публичный URL (S3→imgproxy-подпись; иначе /uploads-путь).
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'no file' }, { status: 400 })

  try {
    const ref = await uploadImageFile('issues', file)
    const url = (await imageUrl(ref, 'rs:fit:1600:1600')) ?? ref
    return Response.json({ url })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
}
