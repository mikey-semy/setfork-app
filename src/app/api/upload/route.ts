import { getSession } from '@/shared/auth/session'
import { imageUrl, uploadAttachmentFile, uploadImageFile } from '@/shared/media'

// Загрузка из markdown-редактора (issues/комментарии). Только для залогиненных.
// Картинка → { url, kind:'image' } (S3→imgproxy / диск); иначе вложение → { url, kind:'file', name }.
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'no file' }, { status: 400 })

  try {
    if (file.type.startsWith('image/')) {
      const ref = await uploadImageFile('issues', file)
      const url = (await imageUrl(ref, 'rs:fit:1600:1600')) ?? ref
      return Response.json({ url, kind: 'image', name: file.name })
    }
    const { url, name } = await uploadAttachmentFile(file)
    return Response.json({ url, kind: 'file', name })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
}
