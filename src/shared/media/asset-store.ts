import 'server-only'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { getObject, hasObject, putObject } from './s3'
import { isS3Configured } from '@/shared/settings/media'
import type { LfsPointer } from '@/core/domain/lfs-pointer'

/**
 * ХРАНИЛИЩЕ ДВОИЧНЫХ ФАЙЛОВ СКИЛЛОВ — по хешу содержимого (ADR-0028 п.4).
 *
 * Ключ — sha256 байтов: одно содержимое лежит один раз, сколько бы версий и списков на него
 * ни ссылались (сто версий с неизменной картинкой — один объект). Объект неизменяем, поэтому
 * удалять его при удалении версии нельзя: на него могут ссылаться другие версии и форки.
 *
 * Где лежит: S3 (закрытый бакет, тот же, что у картинок), ключ `skill-assets/<sha256>`. Без
 * S3 — каталог на диске, но ТОЛЬКО вне продакшена: в контейнере прода такой файл пропал бы с
 * первой выкаткой, а версия продолжала бы на него ссылаться. Прод без S3 — честный отказ.
 */
export class AssetStoreUnavailable extends Error {
  constructor() {
    super('binary skill files need object storage (S3), and it is not configured on this server')
    this.name = 'AssetStoreUnavailable'
  }
}

const key = (oid: string) => `skill-assets/${oid}`
const diskDir = () => process.env.SKILL_ASSETS_DIR || join(process.cwd(), '.data', 'skill-assets')

async function backend(): Promise<'s3' | 'disk'> {
  if (await isS3Configured()) return 's3'
  if (process.env.NODE_ENV === 'production') throw new AssetStoreUnavailable()
  return 'disk'
}

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** Положить байты; уже лежащие не перезаписываются. → указатель для дерева. */
export async function putAsset(bytes: Uint8Array): Promise<LfsPointer> {
  const oid = sha256Hex(bytes)
  if ((await backend()) === 's3') {
    if (!(await hasObject(key(oid)))) await putObject(key(oid), Buffer.from(bytes), 'application/octet-stream')
  } else {
    const dir = diskDir()
    await mkdir(dir, { recursive: true })
    const file = join(dir, oid)
    // Через временный файл: оборванная запись не должна оставить под хешем чужие байты.
    if (!(await stat(file).catch(() => null))) {
      await writeFile(`${file}.tmp`, bytes)
      await rename(`${file}.tmp`, file)
    }
  }
  return { oid, size: bytes.length }
}

/**
 * Байты по указателю. Нет объекта — `null`. Байты сверяются с хешем: указатель в дереве пишет
 * и тот, кто пушит git, и отдать под его хешем другое содержимое значило бы соврать версией.
 */
export async function getAsset(p: LfsPointer): Promise<Uint8Array | null> {
  const bytes = (await backend()) === 's3' ? await getObject(key(p.oid)) : await readFile(join(diskDir(), p.oid)).then((b) => new Uint8Array(b)).catch(() => null)
  if (!bytes) return null
  if (bytes.length !== p.size || sha256Hex(bytes) !== p.oid) throw new Error(`skill asset ${p.oid} does not match its hash`)
  return bytes
}

/** Есть ли объект — для проверки указателя, пришедшего пушем. */
export async function hasAsset(oid: string): Promise<boolean> {
  return (await backend()) === 's3' ? hasObject(key(oid)) : Boolean(await stat(join(diskDir(), oid)).catch(() => null))
}
