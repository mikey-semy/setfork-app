import { getSession } from '@/shared/auth/session'
import { rateLimit, tooMany } from '@/shared/rate-limit'
import { crossOriginBlock } from '@/shared/csrf'
import { isBinary } from '@/core/domain/lfs-pointer'
import { authoredPathProblem } from '@/core/domain/authored-path'
import { assetRefusalText, storeBinary } from '@/features/library/skill-assets'
import { AssetStoreUnavailable } from '@/shared/media/asset-store'

/**
 * POST /api/skill-asset — файл для раздела «Файлы скилла» в редакторе сайта.
 *
 * Отдельным маршрутом, а не полем формы: двоичному файлу разрешено до `ATTACH_MAX_BYTES`, а
 * тело серверного экшена ограничено `serverActions.bodySizeLimit`. Ответ — то, что редактор
 * положит в набор: текст — текстом, двоичное — указателем Git LFS (байты уже в хранилище).
 *
 * Правила — ТЕ ЖЕ, что у MCP и `sf` (`storeBinaryFiles`): двоичное только в `assets/`, без
 * программ, в пределе. Наличие байтов и общий предел скилла ещё раз проверит фасад записи
 * при публикации: этот ответ ничего не записывает в список.
 */
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const blocked = crossOriginBlock(req)
  if (blocked) return blocked
  const session = await getSession()
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 })
  // Реже, чем картинки: объект неизменяем и не удаляется, пока на него может ссылаться версия.
  const rl = await rateLimit(`skill-asset:${session.userId}`, 20, 60 * 60_000)
  if (!rl.ok) return tooMany(rl)

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const path = String(form?.get('path') ?? '')
  if (!(file instanceof File) || !path) return Response.json({ error: 'send the file and its path' }, { status: 400 })
  // Путь — тем же правилом, что у формы и MCP: ответ ляжет в набор как есть.
  if (authoredPathProblem(path, false)) return Response.json({ error: `bad file path "${path}"` }, { status: 400 })

  const bytes = new Uint8Array(await file.arrayBuffer())
  // Текст (в любой папке) — возвращается текстом: его правят в редакторе, как набранный.
  if (!isBinary(bytes)) {
    const text = (() => {
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        return null
      }
    })()
    if (text !== null) return Response.json({ path, kind: 'text', text })
  }
  try {
    // Не-UTF-8 без нулевого байта — тоже двоичное для нас: текстом его не отдать без порчи.
    const stored = await storeBinary(path, bytes)
    if ('refused' in stored) return Response.json({ error: assetRefusalText(stored.refused) }, { status: 400 })
    return Response.json({ path, kind: 'binary', text: stored.pointerText, size: stored.size })
  } catch (e) {
    if (e instanceof AssetStoreUnavailable) return Response.json({ error: e.message }, { status: 503 })
    throw e
  }
}
