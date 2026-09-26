import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ПРЯМАЯ ЗАГРУЗКА В S3: начало, финализация, раздача, подметальщик — на реальной БД.
 *
 * Подменено ТОЛЬКО хранилище (`shared/media/s3`): бакет — словарь «ключ → байты».
 * Настройки медиа настоящие, из env (S3_* ниже), — `isS3Configured` проверяется своим
 * кодом, а не подставленным ответом.
 */
const bucket = vi.hoisted(() => new Map<string, Buffer>())
const presigned = vi.hoisted(() => [] as { key: string; contentType: string; maxBytes: number }[])
vi.mock('@/shared/media/s3', () => ({
  presignPost: vi.fn(async (key: string, contentType: string, maxBytes: number) => {
    presigned.push({ key, contentType, maxBytes })
    return { url: 'https://s3.test/bucket', fields: { key, 'Content-Type': contentType } }
  }),
  headObject: vi.fn(async (key: string) => bucket.get(key)?.length ?? null),
  readHead: vi.fn(async (key: string, n: number) => (bucket.get(key) ?? Buffer.alloc(0)).subarray(0, n)),
  deleteObject: vi.fn(async (key: string) => void bucket.delete(key)),
  signedGetUrl: vi.fn(
    async (key: string, o: { disposition: string; filename: string; contentType: string }) =>
      `https://s3.test/bucket/${key}?disposition=${o.disposition}&filename=${encodeURIComponent(o.filename)}&type=${o.contentType}`,
  ),
}))

const { db, uploads, users } = await import('@/shared/db')
const { clearMediaCache } = await import('@/shared/settings/media')
const { beginUpload, completeUpload, sweepPendingUploads, PENDING_TTL_MS } = await import('@/shared/media/direct-upload')
const { GET: mediaGet } = await import('@/app/media/[...key]/route')
const { VIDEO_MAX_BYTES } = await import('@/shared/media/limits')

const S3_ENV = { S3_ENDPOINT: 'https://s3.test', S3_BUCKET: 'bucket', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 's' }
const saved: Record<string, string | undefined> = {}
function setS3(on: boolean) {
  for (const [k, v] of Object.entries(S3_ENV)) {
    if (on) process.env[k] = v
    else delete process.env[k]
  }
  clearMediaCache()
}

// ISO-BMFF: байты 4..8 = 'ftyp' — настоящая сигнатура mp4.
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(20)])
const PDF = Buffer.from('%PDF-1.7 hello')

let alice: string
let bob: string

beforeAll(() => {
  for (const k of Object.keys(S3_ENV)) saved[k] = process.env[k]
})
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  clearMediaCache()
})

beforeEach(async () => {
  await resetTables([uploads, users])
  bucket.clear()
  presigned.length = 0
  setS3(true)
  ;[{ id: alice }, { id: bob }] = await db
    .insert(users)
    .values([{ handle: 'alice-up' }, { handle: 'bob-up' }])
    .returning({ id: users.id })
})

/** Начать загрузку и «положить» в бакет то, что прислал бы браузер. */
async function begun(userId: string, name: string, bytes: Buffer, kind: 'file' | 'video' = 'file') {
  const res = await beginUpload(userId, { kind, name, size: bytes.length })
  if ('error' in res) throw new Error(res.error)
  bucket.set(presigned.at(-1)!.key, bytes)
  return res
}

const mediaReq = (key: string) => mediaGet(new Request(`http://x/media/${key}`), { params: Promise.resolve({ key: key.split('/') }) })

describe('beginUpload', () => {
  it('без S3 — storage_unavailable, строки нет', async () => {
    setS3(false)
    expect(await beginUpload(alice, { kind: 'file', name: 'a.pdf', size: 10 })).toEqual({ error: 'storage_unavailable' })
    expect(await db.select().from(uploads)).toHaveLength(0)
  })

  it('ключ придумывает сервер: вид, владелец, uuid и расширение из белого списка', async () => {
    const res = await beginUpload(alice, { kind: 'video', name: '../../клип.MP4', size: 100 })
    expect('id' in res).toBe(true)
    const [row] = await db.select().from(uploads)
    expect(row.key).toMatch(new RegExp(`^videos/${alice}/[0-9a-f-]{36}\\.mp4$`))
    expect(row).toMatchObject({ status: 'pending', name: 'клип.MP4', contentType: 'video/mp4', size: 100 })
    // Политика подписана на тот же ключ, тот же тип и предел вида.
    expect(presigned[0]).toEqual({ key: row.key, contentType: 'video/mp4', maxBytes: VIDEO_MAX_BYTES })
  })

  it('отказы по таблице видов: тип, размер, пустой, мусор в запросе', async () => {
    expect(await beginUpload(alice, { kind: 'file', name: 'x.svg', size: 10 })).toEqual({ error: 'bad_type' })
    expect(await beginUpload(alice, { kind: 'file', name: 'x.exe', size: 10 })).toEqual({ error: 'bad_type' })
    expect(await beginUpload(alice, { kind: 'video', name: 'x.mp4', size: VIDEO_MAX_BYTES + 1 })).toEqual({ error: 'too_big' })
    expect(await beginUpload(alice, { kind: 'file', name: 'x.pdf', size: 0 })).toEqual({ error: 'empty' })
    expect(await beginUpload(alice, { kind: 'image', name: 'x.png', size: 10 })).toEqual({ error: 'bad_request' })
    expect(await db.select().from(uploads)).toHaveLength(0)
  })
})

describe('completeUpload', () => {
  it('вложение: done, реальный размер, ссылка /media/<key>; повтор — тот же ответ', async () => {
    const { id } = await begun(alice, 'отчёт.pdf', PDF)
    const [{ key }] = await db.select().from(uploads)
    expect(await completeUpload(alice, id)).toEqual({ url: `/media/${key}`, name: 'отчёт.pdf' })
    const [row] = await db.select().from(uploads)
    expect(row).toMatchObject({ status: 'done', size: PDF.length })
    expect(row.completedAt).not.toBeNull()
    expect(await completeUpload(alice, id)).toEqual({ url: `/media/${key}`, name: 'отчёт.pdf' })
  })

  it('чужая загрузка — not_found, строка не тронута', async () => {
    const { id } = await begun(alice, 'a.pdf', PDF)
    expect(await completeUpload(bob, id)).toEqual({ error: 'not_found' })
    expect(await completeUpload(bob, 'не-uuid')).toEqual({ error: 'not_found' })
    const [row] = await db.select().from(uploads)
    expect(row.status).toBe('pending')
  })

  it('объекта нет в бакете — not_uploaded, строка ждёт повтора', async () => {
    const res = await beginUpload(alice, { kind: 'file', name: 'a.pdf', size: 10 })
    if ('error' in res) throw new Error(res.error)
    expect(await completeUpload(alice, res.id)).toEqual({ error: 'not_uploaded' })
    expect((await db.select().from(uploads))[0].status).toBe('pending')
  })

  it('клип: сигнатура видео того же типа, что обещало расширение', async () => {
    const { id } = await begun(alice, 'clip.mp4', MP4, 'video')
    const res = await completeUpload(alice, id)
    expect(res).toMatchObject({ name: 'clip.mp4' })
    expect((await db.select().from(uploads))[0].status).toBe('done')
  })

  it('«клип» не видео по сигнатуре — bad_type, объект и строка удалены', async () => {
    const { id } = await begun(alice, 'clip.mp4', Buffer.from('<html><script>alert(1)</script>'), 'video')
    const key = presigned[0].key
    expect(await completeUpload(alice, id)).toEqual({ error: 'bad_type' })
    expect(bucket.has(key)).toBe(false)
    expect(await db.select().from(uploads)).toHaveLength(0)
  })

  it('.mov с iPhone (QuickTime) — done и раздаётся как video/quicktime', async () => {
    const qt = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  '), Buffer.alloc(20)])
    const { id } = await begun(alice, 'IMG_0001.MOV', qt, 'video')
    expect(await completeUpload(alice, id)).toMatchObject({ name: 'IMG_0001.MOV' })
    const [row] = await db.select().from(uploads)
    expect(row).toMatchObject({ status: 'done', contentType: 'video/quicktime' })
    expect(row.key.endsWith('.mov')).toBe(true)
    expect((await mediaReq(row.key)).headers.get('location')).toContain('type=video/quicktime')
  })

  it('mp4 под расширением .mov — bad_type: бренд обязан совпасть с расширением', async () => {
    const { id } = await begun(alice, 'clip.mov', MP4, 'video')
    expect(await completeUpload(alice, id)).toEqual({ error: 'bad_type' })
  })

  it('webm под расширением .mp4 — bad_type: тип объекта обязан совпасть с расширением', async () => {
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(20)])
    const { id } = await begun(alice, 'clip.mp4', webm, 'video')
    expect(await completeUpload(alice, id)).toEqual({ error: 'bad_type' })
  })

  it('в бакете больше предела (политику обошли) — too_big, объект и строка удалены', async () => {
    const res = await beginUpload(alice, { kind: 'file', name: 'a.pdf', size: 10 })
    if ('error' in res) throw new Error(res.error)
    const key = presigned[0].key
    bucket.set(key, Buffer.alloc(26 * 1024 * 1024))
    expect(await completeUpload(alice, res.id)).toEqual({ error: 'too_big' })
    expect(bucket.has(key)).toBe(false)
    expect(await db.select().from(uploads)).toHaveLength(0)
  })
})

describe('GET /media/[...key]', () => {
  it('нет строки — 404, без кеша', async () => {
    const res = await mediaReq('files/nobody/x.pdf')
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('pending (не финализирован) — 404: в обход финализации файл не отдаётся', async () => {
    await begun(alice, 'a.pdf', PDF)
    expect((await mediaReq(presigned[0].key)).status).toBe(404)
  })

  it('вложение — 302 на подпись со скачиванием под исходным именем', async () => {
    const { id } = await begun(alice, 'отчёт.pdf', PDF)
    await completeUpload(alice, id)
    const res = await mediaReq(presigned[0].key)
    expect(res.status).toBe(302)
    const loc = res.headers.get('location')!
    expect(loc).toContain('disposition=attachment')
    expect(loc).toContain(`filename=${encodeURIComponent('отчёт.pdf')}`)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('клип — 302 инлайн со своим типом (играет <video>)', async () => {
    const { id } = await begun(alice, 'clip.webm', Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(20)]), 'video')
    await completeUpload(alice, id)
    const loc = (await mediaReq(presigned[0].key)).headers.get('location')!
    expect(loc).toContain('disposition=inline')
    expect(loc).toContain('type=video/webm')
  })
})

describe('sweepPendingUploads', () => {
  it('pending старше суток — объект и строка убраны; свежий pending и done — целы', async () => {
    await begun(alice, 'old.pdf', PDF)
    const oldKey = presigned[0].key
    await db.update(uploads).set({ createdAt: new Date(Date.now() - PENDING_TTL_MS - 60_000) }).where(eq(uploads.key, oldKey))
    await begun(alice, 'fresh.pdf', PDF)
    const freshKey = presigned[1].key
    const { id: doneId } = await begun(alice, 'done.pdf', PDF)
    await completeUpload(alice, doneId)
    const doneKey = presigned[2].key
    await db.update(uploads).set({ createdAt: new Date(Date.now() - 2 * PENDING_TTL_MS) }).where(eq(uploads.key, doneKey))

    expect(await sweepPendingUploads()).toBe(1)
    expect(bucket.has(oldKey)).toBe(false)
    expect(bucket.has(freshKey)).toBe(true)
    expect(bucket.has(doneKey)).toBe(true)
    const left = (await db.select({ key: uploads.key }).from(uploads)).map((r) => r.key).sort()
    expect(left).toEqual([freshKey, doneKey].sort())
  })
})
