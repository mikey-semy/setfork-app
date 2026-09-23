import { findServedUpload } from '@/shared/media/direct-upload'
import { signedGetUrl } from '@/shared/media/s3'
import { noStoreHeaders } from '@/shared/http/cache'

/**
 * Раздача прямых загрузок: `/media/<key>` → 302 на подписанную ссылку хранилища.
 *
 * Ссылка в блоке/markdown — наша и постоянная; подпись — короткая и выдаётся на
 * каждый переход. Отдаём только финализированные (`done`) загрузки: объект, который
 * лёг в бакет в обход финализации, отсюда не откроется.
 *
 * ВИДИМОСТЬ: файл доступен всякому, у кого есть ссылка, — как картинки через imgproxy.
 * Ключ содержит случайный uuid, угадать его нельзя; привязки к видимости списка нет
 * НАМЕРЕННО (один файл может жить в нескольких списках и комментариях). Строже —
 * отдельное решение, не здесь.
 *
 * Вложение — `attachment` с исходным именем (скачивание, а не показ: инлайн-HTML/PDF
 * из хранилища не исполняется на глазах у читателя). Клип — `inline` со своим типом,
 * чтобы играл `<video>`.
 */
export const runtime = 'nodejs'

/**
 * Срок подписи. Сверяется при КАЖДОМ запросе к хранилищу, а `<video>` перематывает
 * Range-запросами по той же ссылке: слишком короткий срок оборвал бы просмотр
 * клипа на паузе. 15 минут — длиннее любого клипа до 50 МБ и всё ещё короткоживущая
 * ссылка; новая выдаётся на каждый переход по `/media/…`.
 */
const SIGNED_URL_TTL_SEC = 15 * 60

export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params
  // Ключи — только uuid, латиница и точка (их придумал сервер), декодировать нечего.
  const key = parts.join('/')
  const row = await findServedUpload(key)
  if (!row) return new Response('Not found', { status: 404, headers: noStoreHeaders() })

  const location = await signedGetUrl(row.key, {
    disposition: row.kind === 'video' ? 'inline' : 'attachment',
    filename: row.name,
    contentType: row.contentType,
    expiresSec: SIGNED_URL_TTL_SEC,
  })
  // Подписанную ссылку не кешируем: она истекает, а кеш отдал бы уже мёртвую.
  return new Response(null, { status: 302, headers: { Location: location, ...noStoreHeaders() } })
}
