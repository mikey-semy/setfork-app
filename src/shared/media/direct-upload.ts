import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq, lt } from 'drizzle-orm'
import { db, uploads } from '@/shared/db'
import { captureError } from '@/shared/observability'
import { rateLimit } from '@/shared/rate-limit'
import { isS3Configured } from '@/shared/settings/media'
import { fileExt, isUploadKind, uploadContentType, UPLOAD_KINDS, type UploadKind, type UploadServerError } from './limits'
import { deleteObject, headObject, presignPost, readHead } from './s3'
import { SNIFF_BYTES, sniffVideo } from './sniff'

/**
 * Тяжёлые загрузки НАПРЯМУЮ в S3 — форма GitHub.com: сервер выдаёт подписанную
 * POST-политику на придуманный им ключ → браузер шлёт файл в бакет → сервер
 * финализирует (проверяет, что лежит в бакете) и только тогда отдаёт ссылку.
 *
 * Байты мимо приложения: у server action предел тела 1 МБ, а диск контейнера на проде
 * не переживает выкатку. Без HTTP — маршруты `/api/uploads` лишь переводят запрос сюда.
 *
 * ⚠️ ОТКЛОНЕНИЕ от Gitea/GHES: у тех есть запасной путь через приложение. Здесь без
 * настроенного S3 тяжёлый файл не грузится вовсе — `storage_unavailable`, и клиент
 * называет причину. Решение владельца: писать 50 МБ на диск, который исчезнет при
 * следующей выкатке, хуже, чем честно отказать.
 */

/** Коды отказов (общий словарь с клиентом — `limits.ts`). Тексты — на клиенте, через i18n. */
export type UploadError = UploadServerError

/** HTTP-статус отказа — для маршрутов; клиент читает код из тела, статус для журналов и прокси. */
export const UPLOAD_ERROR_STATUS: Record<UploadError, number> = {
  storage_unavailable: 503,
  bad_request: 400,
  empty: 400,
  too_big: 413,
  bad_type: 415,
  not_found: 404,
  not_uploaded: 409,
}

/**
 * Срок подписанной политики. Хранилище сверяет его в МОМЕНТ НАЧАЛА POST, а не конца:
 * медленная загрузка, начатая вовремя, дойдёт. Браузер шлёт файл сразу после ответа
 * begin, поэтому запас нужен только на задержку до старта; 10 минут — с избытком и
 * без долгоживущих подписей в истории браузера.
 */
const POLICY_TTL_SEC = 10 * 60

/** Сколько `pending` считается живой загрузкой. Сутки — заведомо дольше любой загрузки
 *  50 МБ, даже по мобильной связи; старше — брошено (закрыли вкладку, упала связь). */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Общий лимит на загрузки пользователя — один ключ на оба пути (картинки через
 * `/api/upload` и прямые в S3): 40 файлов за 5 минут, как было у `/api/upload`.
 * Считается начало загрузки, а не финализация: финализация не заводит новых
 * объектов и возможна только для уже начатой.
 */
export const uploadRateLimit = (userId: string) => rateLimit(`upload:${userId}`, 40, 5 * 60_000)

/** Имя для показа и `Content-Disposition`: без пути, управляющих символов и лишней длины. */
function cleanName(name: string, ext: string): string {
  const base = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/^.*[\\/]/, '').trim()
  return (base || `file.${ext}`).slice(-255)
}

export type BeginInput = { kind: unknown; name: unknown; size: unknown }
export type BeginResult = { id: string; url: string; fields: Record<string, string> } | { error: UploadError }

export async function beginUpload(userId: string, input: BeginInput): Promise<BeginResult> {
  const { kind, name, size } = input
  if (!isUploadKind(kind) || typeof name !== 'string' || typeof size !== 'number' || !Number.isInteger(size)) {
    return { error: 'bad_request' }
  }
  if (!(await isS3Configured())) return { error: 'storage_unavailable' }

  const ext = fileExt(name)
  const contentType = uploadContentType(kind, ext)
  if (!contentType) return { error: 'bad_type' }
  if (size <= 0) return { error: 'empty' }
  const { maxBytes } = UPLOAD_KINDS[kind]
  if (size > maxBytes) return { error: 'too_big' }

  // Ключ придумывает СЕРВЕР: браузер не выберет ни чужую папку, ни опасное расширение.
  const key = `${kind}s/${userId}/${randomUUID()}.${ext}`
  const [row] = await db
    .insert(uploads)
    .values({ userId, kind, key, name: cleanName(name, ext), size, contentType, status: 'pending' })
    .returning({ id: uploads.id })
  const post = await presignPost(key, contentType, maxBytes, POLICY_TTL_SEC)
  return { id: row.id, url: post.url, fields: post.fields }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ссылка, которую получают блок и markdown: раздаёт `/media/[...key]`. */
export const mediaUrl = (key: string): string => `/media/${key}`

/**
 * Проверка того, что РЕАЛЬНО лежит в бакете. Размер хранилище уже ограничило
 * политикой, но проверяем ещё раз: политика — чужой код, а ссылку выдаём мы.
 * Клип обязан быть видео по сигнатуре и того же типа, что обещало расширение, —
 * иначе `<video>` получил бы что угодно под видом mp4.
 */
async function objectRejection(kind: UploadKind, key: string, contentType: string, size: number): Promise<UploadError | null> {
  if (size <= 0) return 'empty'
  if (size > UPLOAD_KINDS[kind].maxBytes) return 'too_big'
  if (kind === 'video' && sniffVideo(await readHead(key, SNIFF_BYTES)) !== contentType) return 'bad_type'
  // Вложение — по расширению (оно задано сервером и отдаётся только скачиванием).
  return null
}

export type CompleteResult = { url: string; name: string } | { error: UploadError }

export async function completeUpload(userId: string, id: unknown): Promise<CompleteResult> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return { error: 'not_found' }
  if (!(await isS3Configured())) return { error: 'storage_unavailable' }
  const [row] = await db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, id), eq(uploads.userId, userId)))
    .limit(1)
  if (!row || !isUploadKind(row.kind)) return { error: 'not_found' }
  // Повтор финализации (обрыв связи на ответе) — тот же результат, а не ошибка.
  if (row.status === 'done') return { url: mediaUrl(row.key), name: row.name }

  const size = await headObject(row.key)
  // Объекта нет: браузер ещё не дослал или не смог. Строку не трогаем — повтор
  // возможен, а брошенное уберёт подметальщик.
  if (size === null) return { error: 'not_uploaded' }

  const rejected = await objectRejection(row.kind, row.key, row.contentType, size)
  if (rejected) {
    // Сначала объект, потом строка: упади удаление объекта — строка останется
    // `pending`, и его доберёт подметальщик. Наоборот объект осиротел бы навсегда.
    await deleteObject(row.key)
    await db.delete(uploads).where(eq(uploads.id, row.id))
    return { error: rejected }
  }
  await db
    .update(uploads)
    .set({ status: 'done', size, completedAt: new Date() })
    .where(and(eq(uploads.id, row.id), eq(uploads.status, 'pending')))
  return { url: mediaUrl(row.key), name: row.name }
}

/** Строка раздачи: только финализированная загрузка. */
export async function findServedUpload(key: string) {
  const [row] = await db
    .select({ key: uploads.key, kind: uploads.kind, name: uploads.name, contentType: uploads.contentType })
    .from(uploads)
    .where(and(eq(uploads.key, key), eq(uploads.status, 'done')))
    .limit(1)
  return row ?? null
}

/**
 * Брошенные загрузки: `pending` старше `PENDING_TTL_MS` → объект и строка удаляются.
 * За проход не больше `batch`, чтобы авария не превратилась в один бесконечный проход;
 * остальное доберёт следующий. Сбой одной строки не останавливает остальные.
 * Возвращает число убранных.
 */
export async function sweepPendingUploads(now: Date = new Date(), batch = 100): Promise<number> {
  if (!(await isS3Configured())) return 0
  const stale = await db
    .select({ id: uploads.id, key: uploads.key })
    .from(uploads)
    .where(and(eq(uploads.status, 'pending'), lt(uploads.createdAt, new Date(now.getTime() - PENDING_TTL_MS))))
    .limit(batch)
  let removed = 0
  for (const row of stale) {
    try {
      await deleteObject(row.key) // удаление отсутствующего объекта в S3 — не ошибка
      await db.delete(uploads).where(and(eq(uploads.id, row.id), eq(uploads.status, 'pending')))
      removed++
    } catch (e) {
      captureError(e, { where: 'uploads.sweep', key: row.key })
    }
  }
  return removed
}
