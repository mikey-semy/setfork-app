import { getSession } from '@/shared/auth/session'
import { imageUrl, uploadAttachmentFile, uploadImageFile, uploadVideoFile } from '@/shared/media'
import { rateLimit, tooMany } from '@/shared/rate-limit'
import { crossOriginBlock } from '@/shared/csrf'

// Загрузка из markdown-редактора (issues/комментарии) И из редактора списков —
// через XHR ради реального прогресса отправки. Только для залогиненных.
// Ветвление по `kind` (см. shared/lib/xhr-upload); без kind → markdown-дефолт:
// картинка → { url, kind:'image' } (S3→imgproxy / диск); иначе вложение → { url, kind:'file', name }.
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const blocked = crossOriginBlock(req)
  if (blocked) return blocked
  const session = await getSession()
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const rl = await rateLimit(`upload:${session.userId}`, 40, 5 * 60_000) // 40 загрузок / 5 мин
  if (!rl.ok) return tooMany(rl)

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'no file' }, { status: 400 })
  const kind = String(form?.get('kind') ?? '')

  try {
    // Редактор списков: та же логика, что серверные экшены uploadStep* (library/actions).
    if (kind === 'step-image') {
      const key = await uploadImageFile(`steps/${session.userId}`, file)
      return Response.json({ key, url: (await imageUrl(key, 'rs:fit:960:960')) ?? '' })
    }
    if (kind === 'step-video') {
      const url = await uploadVideoFile(`videos/${session.userId}`, file)
      return Response.json({ url })
    }
    if (kind === 'step-file') {
      const { url, name } = await uploadAttachmentFile(file)
      return Response.json({ url, name })
    }
    // Дефолт — markdown-редактор (issues/комментарии).
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
