import 'server-only'
import { AuthoredFilesError, type AuthoredFile } from '@/core'
import { binaryAllowedAt, isBinary, lfsPointerOf, lfsPointerText, nativeExecutable } from '@/core/domain/lfs-pointer'
import { megabytes } from '@/shared/media/limits'
import { SKILL_ASSETS_MAX_BYTES } from '@/core/domain/skill-limits'
import { AssetStoreUnavailable, getAsset, hasAsset, putAsset } from '@/shared/media/asset-store'
import { captureError } from '@/shared/observability'

/** Почему двоичный файл не принят — код для текста на каждом входе (MCP, сайт, CLI). */
export type AssetRefusal =
  | { code: 'binary-outside-assets'; path: string }
  | { code: 'executable'; path: string; kind: string }
  | { code: 'too-big'; path: string; max: number }
  | { code: 'too-big-total'; max: number }

export function assetRefusalText(r: AssetRefusal): string {
  const mb = (n: number) => `${megabytes(n)} MB`
  switch (r.code) {
    case 'binary-outside-assets':
      return `"${r.path}" is a binary file — binary files go to assets/; scripts/ and references/ keep text only`
    case 'executable':
      return `"${r.path}" is a native program (${r.kind}) — a skill does not ship executables for any platform`
    case 'too-big':
      return `"${r.path}" is larger than ${mb(r.max)}`
    case 'too-big-total':
      return `binary files of the skill together are larger than ${mb(r.max)}`
  }
}

/**
 * Двоичные файлы набора → в хранилище, в набор — их указатели Git LFS. Текст остаётся как
 * есть. Предел — `SKILL_ASSETS_MAX_BYTES` на файл и на все двоичные файлы скилла вместе: он
 * выведен из предела установщика `npx skills` (см. `skill-limits`).
 *
 * Байты кладутся ДО записи версии: если запись потом откажет, объект останется ненужным, но
 * безвредным — он неизменяем и адресован хешем, и следующая попытка найдёт его на месте.
 */
/** Почему этот файл нельзя хранить двоичным — одно правило для набора и для загрузки. */
function binaryRefusal(path: string, bytes: Uint8Array): AssetRefusal | null {
  if (!binaryAllowedAt(path)) return { code: 'binary-outside-assets', path }
  const exe = nativeExecutable(bytes)
  if (exe) return { code: 'executable', path, kind: exe }
  if (bytes.length > SKILL_ASSETS_MAX_BYTES) return { code: 'too-big', path, max: SKILL_ASSETS_MAX_BYTES }
  return null
}

/** Один файл → хранилище, как двоичный (загрузка из редактора: байты, не ставшие текстом). */
export async function storeBinary(path: string, bytes: Uint8Array): Promise<{ pointerText: string; size: number } | { refused: AssetRefusal }> {
  const refused = binaryRefusal(path, bytes)
  if (refused) return { refused }
  const pointer = await putAsset(bytes)
  return { pointerText: lfsPointerText(pointer), size: pointer.size }
}

export async function storeBinaryFiles(files: AuthoredFile[]): Promise<{ files: AuthoredFile[] } | { refused: AssetRefusal }> {
  let total = 0
  for (const f of files) {
    if (!isBinary(f.content)) continue
    const refused = binaryRefusal(f.path, f.content)
    if (refused) return { refused }
    total += f.content.length
  }
  if (total > SKILL_ASSETS_MAX_BYTES) return { refused: { code: 'too-big-total', max: SKILL_ASSETS_MAX_BYTES } }
  // Файлы независимы — кладём разом; порядок набора сохраняет map.
  const out = await Promise.all(
    files.map(async (f) =>
      isBinary(f.content) ? { ...f, content: new TextEncoder().encode(lfsPointerText(await putAsset(f.content))), executable: false } : f,
    ),
  )
  return { files: out }
}

/** Двоичные файлы набора вместе больше предела — по размерам из указателей. */
export function assetsOverLimit(files: AuthoredFile[]): AssetRefusal | null {
  const total = files.reduce((n, f) => n + (binaryAllowedAt(f.path) ? (lfsPointerOf(f.content)?.size ?? 0) : 0), 0)
  return total > SKILL_ASSETS_MAX_BYTES ? { code: 'too-big-total', max: SKILL_ASSETS_MAX_BYTES } : null
}

/**
 * Указатели в `assets/` → настоящие байты, для выдачи (архив скилла, файл по адресу).
 * Объекта нет или он не сходится с хешем — файл в выдачу не идёт, путь — в `missing`: отдать
 * вместо картинки текст указателя значило бы молча положить агенту мусор.
 */
export async function resolveAssetFiles(files: AuthoredFile[], where: Record<string, unknown>): Promise<{ files: AuthoredFile[]; missing: string[] }> {
  const resolved = await Promise.all(
    files.map(async (f) => {
      const pointer = binaryAllowedAt(f.path) ? lfsPointerOf(f.content) : null
      if (!pointer) return f
      const bytes = await getAsset(pointer).catch((e) => {
        captureError(e, { where: 'skill-assets.resolve', path: f.path, oid: pointer.oid, ...where })
        return null
      })
      return bytes ? { ...f, content: bytes } : { missing: f.path }
    }),
  )
  const out = resolved.filter((r): r is AuthoredFile => !('missing' in r))
  const missing = resolved.flatMap((r) => ('missing' in r ? [r.missing] : []))
  return { files: out, missing }
}

/**
 * СТРАЖ ФАСАДА ЗАПИСИ: указатели набора ссылаются на байты, которые у нас ЕСТЬ, и двоичных
 * файлов вместе не больше предела. Стоит на фасаде, а не на каждом входе: указатель приносят и
 * MCP, и редактор, и откат, и форк — пропустить его на одном из путей значило бы записать
 * версию, чей файл никто никогда не скачает.
 */
export async function assertAssetsStored(files: AuthoredFile[] | undefined): Promise<void> {
  if (!files) return
  const over = assetsOverLimit(files)
  if (over) throw new AuthoredFilesError('invalid', assetRefusalText(over))
  const pointers = files.flatMap((f) => {
    const pointer = binaryAllowedAt(f.path) ? lfsPointerOf(f.content) : null
    return pointer ? [{ path: f.path, oid: pointer.oid }] : []
  })
  const stored = await Promise.all(
    pointers.map((p) =>
      hasAsset(p.oid).catch((e) => {
        if (e instanceof AssetStoreUnavailable) throw new AuthoredFilesError('invalid', e.message)
        throw e
      }),
    ),
  )
  // Первый по порядку набора — чтобы отказ называл один и тот же файл при повторе.
  const lost = pointers.find((_, i) => !stored[i])
  if (lost) throw new AuthoredFilesError('invalid', `${lost.path}: its bytes are not in storage — upload the file again`)
}
