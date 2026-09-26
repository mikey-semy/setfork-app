import 'server-only'
import { AuthoredFilesError, type AuthoredFile } from '@/core'
import { binaryAllowedAt, isBinary, lfsPointerOf, lfsPointerText, nativeExecutable } from '@/core/domain/lfs-pointer'
import { ATTACH_MAX_BYTES, megabytes } from '@/shared/media/limits'
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
 * есть. Предел — тот же, что у вложений (`ATTACH_MAX_BYTES`): на файл и на все двоичные
 * файлы скилла вместе — второго числа тут нет.
 *
 * Байты кладутся ДО записи версии: если запись потом откажет, объект останется ненужным, но
 * безвредным — он неизменяем и адресован хешем, и следующая попытка найдёт его на месте.
 */
/** Почему этот файл нельзя хранить двоичным — одно правило для набора и для загрузки. */
function binaryRefusal(path: string, bytes: Uint8Array): AssetRefusal | null {
  if (!binaryAllowedAt(path)) return { code: 'binary-outside-assets', path }
  const exe = nativeExecutable(bytes)
  if (exe) return { code: 'executable', path, kind: exe }
  if (bytes.length > ATTACH_MAX_BYTES) return { code: 'too-big', path, max: ATTACH_MAX_BYTES }
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
  if (total > ATTACH_MAX_BYTES) return { refused: { code: 'too-big-total', max: ATTACH_MAX_BYTES } }
  const out: AuthoredFile[] = []
  for (const f of files) {
    if (!isBinary(f.content)) {
      out.push(f)
      continue
    }
    const pointer = await putAsset(f.content)
    out.push({ ...f, content: new TextEncoder().encode(lfsPointerText(pointer)), executable: false })
  }
  return { files: out }
}

/** Двоичные файлы набора вместе больше предела — по размерам из указателей. */
export function assetsOverLimit(files: AuthoredFile[]): AssetRefusal | null {
  const total = files.reduce((n, f) => n + (binaryAllowedAt(f.path) ? (lfsPointerOf(f.content)?.size ?? 0) : 0), 0)
  return total > ATTACH_MAX_BYTES ? { code: 'too-big-total', max: ATTACH_MAX_BYTES } : null
}

/**
 * Указатели в `assets/` → настоящие байты, для выдачи (архив скилла, файл по адресу).
 * Объекта нет или он не сходится с хешем — файл в выдачу не идёт, путь — в `missing`: отдать
 * вместо картинки текст указателя значило бы молча положить агенту мусор.
 */
export async function resolveAssetFiles(files: AuthoredFile[], where: Record<string, unknown>): Promise<{ files: AuthoredFile[]; missing: string[] }> {
  const out: AuthoredFile[] = []
  const missing: string[] = []
  for (const f of files) {
    const pointer = binaryAllowedAt(f.path) ? lfsPointerOf(f.content) : null
    if (!pointer) {
      out.push(f)
      continue
    }
    const bytes = await getAsset(pointer).catch((e) => {
      captureError(e, { where: 'skill-assets.resolve', path: f.path, oid: pointer.oid, ...where })
      return null
    })
    if (bytes) out.push({ ...f, content: bytes })
    else missing.push(f.path)
  }
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
  for (const f of files) {
    const pointer = binaryAllowedAt(f.path) ? lfsPointerOf(f.content) : null
    if (!pointer) continue
    const stored = await hasAsset(pointer.oid).catch((e) => {
      if (e instanceof AssetStoreUnavailable) throw new AuthoredFilesError('invalid', e.message)
      throw e
    })
    if (!stored) throw new AuthoredFilesError('invalid', `${f.path}: its bytes are not in storage — upload the file again`)
  }
}
