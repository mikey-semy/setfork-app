/**
 * Лимиты загрузки — одно место на сервер и на интерфейс.
 *
 * `upload.ts` серверный (`server-only`), поэтому клиентский редактор импортировать его
 * не может — и подпись дропзоны носила своё число («до 50 МБ»), а отказ сервера своё.
 * Числа живут здесь: файл ничего не тянет и годится обеим сторонам.
 */
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024 // клип без транскодинга; часовые лекции — Cloudflare Stream позже
export const ATTACH_MAX_BYTES = 25 * 1024 * 1024 // вложение (PDF/док/архив)

/** Байты → мегабайты для подписей и сообщений об отказе. */
export const megabytes = (bytes: number): number => Math.round(bytes / 1024 / 1024)

/** Картинка (скриншот шага, обложка, картинка редактора). ⚠️ Это число держит и
 *  `serverActions.bodySizeLimit` в next.config.mjs: предел тела экшена у Next по
 *  умолчанию 1 МБ, и пока его не подняли, файл в 1–4 МБ отклонялся ДО нашего кода.
 *  Связь стережёт tests/architecture/image-limit-vs-action-body.test.ts. */
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024

/** Форматы картинок, которые сервер распознаёт по сигнатуре (см. sniffImage). Тот же
 *  список — в `accept` поля выбора: на iOS явный список заставляет Safari перекодировать
 *  HEIC в JPEG, а `image/*` пропускает HEIC как есть, и сервер его отвергает. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** Значение `accept` для поля выбора картинки — из того же списка, а не копией строки. */
export const IMAGE_ACCEPT = IMAGE_TYPES.join(',')

export type ImageRejection = 'too_big' | 'bad_type'

/**
 * Проверка ДО отправки — чтобы причину отказа человек увидел сразу, а не после
 * загрузки мегабайтов по мобильной сети. Пустой `type` (браузер не опознал файл)
 * пропускаем: решает сервер по содержимому, он авторитетен.
 */
export function imageRejection(file: { size: number; type: string }): ImageRejection | null {
  if (file.size > IMAGE_MAX_BYTES) return 'too_big'
  if (file.type && !(IMAGE_TYPES as readonly string[]).includes(file.type)) return 'bad_type'
  return null
}

/**
 * Тяжёлые загрузки (вложение file-блока и свой клип video-блока) — одна таблица на
 * сервер и на клиент. Идут НАПРЯМУЮ в S3 по подписанной POST-политике (как у GitHub):
 * через приложение они не проходят — у server action предел тела 1 МБ.
 *
 * `ext` — белый список «расширение → Content-Type», с которым объект ляжет в хранилище.
 * Тип задаёт СЕРВЕР по расширению; mime, присланный браузером, не доверяем (его пишет
 * кто угодно). Вложение отдаётся только скачиванием (`attachment`), поэтому ему хватает
 * `application/octet-stream`: инлайн-показа, а значит и исполнения, у него не бывает.
 *
 * SVG НАМЕРЕННО исключён: `<script>` внутри SVG → хранимый XSS, если файл когда-нибудь
 * откроют инлайн. Исполняемое и скриптовое не пускаем по той же причине.
 */
const OCTET = 'application/octet-stream'
export const UPLOAD_KINDS = {
  file: {
    maxBytes: ATTACH_MAX_BYTES,
    ext: {
      pdf: OCTET,
      txt: OCTET,
      md: OCTET,
      csv: OCTET,
      json: OCTET,
      log: OCTET,
      zip: OCTET,
      gz: OCTET,
      tar: OCTET,
      doc: OCTET,
      docx: OCTET,
      xls: OCTET,
      xlsx: OCTET,
      ppt: OCTET,
      pptx: OCTET,
    },
  },
  video: {
    maxBytes: VIDEO_MAX_BYTES,
    // Клип проигрывается `<video>` инлайн — тип обязан быть настоящим; при финализации
    // он сверяется с сигнатурой содержимого (`sniffVideo`).
    // mov — iPhone снимает в QuickTime; GitHub MOV принимает. Играет ли он в браузере,
    // решает кодек, а не контейнер: H.264 — везде, HEVC — в Safari (Chrome/Firefox
    // зависят от ОС и железа).
    ext: { mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', ogg: 'video/ogg', mov: 'video/quicktime' },
  },
} as const satisfies Record<string, { maxBytes: number; ext: Record<string, string> }>

export type UploadKind = keyof typeof UPLOAD_KINDS

export const isUploadKind = (v: unknown): v is UploadKind => typeof v === 'string' && Object.hasOwn(UPLOAD_KINDS, v)

/** Расширение имени файла в нижнем регистре ('' — без точки). */
export function fileExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Content-Type объекта по виду и расширению; null — расширение не из белого списка. */
export function uploadContentType(kind: UploadKind, ext: string): string | null {
  const table: Record<string, string> = UPLOAD_KINDS[kind].ext
  return Object.hasOwn(table, ext) ? table[ext] : null
}

/** Значение `accept` для `<input type=file>` — из той же таблицы, что и проверка. */
export const uploadAccept = (kind: UploadKind): string =>
  Object.keys(UPLOAD_KINDS[kind].ext)
    .map((e) => `.${e}`)
    .join(',')

export type UploadRejection = 'empty' | 'too_big' | 'bad_type'

/**
 * Предпроверка до сети — те же правила, что у сервера (он проверяет заново: клиенту
 * верить нельзя, но и гонять 50 МБ ради заведомого отказа незачем). Пустой файл —
 * отдельной причиной: политика хранилища его не примет (`content-length-range` от 1).
 */
export function uploadRejection(kind: UploadKind, file: { name: string; size: number }): UploadRejection | null {
  if (!uploadContentType(kind, fileExt(file.name))) return 'bad_type'
  if (file.size <= 0) return 'empty'
  if (file.size > UPLOAD_KINDS[kind].maxBytes) return 'too_big'
  return null
}

/**
 * Все причины, по которым прямая загрузка не удалась, — общий словарь сервера и
 * клиента. Сервер отдаёт код, текст выбирает клиент на языке человека
 * (`upload-client.uploadErrorText`).
 *   * серверные: предпроверка заново + `storage_unavailable` (S3 не настроен),
 *     `bad_request`, `not_found` (чужая/несуществующая загрузка), `not_uploaded`
 *     (в бакете нет объекта на финализации);
 *   * клиентские: `network` (обрыв, в т.ч. CORS бакета), `storage_rejected` (бакет
 *     отказал POST: истекла политика, не тот размер), `rate_limited`, `unauthorized`,
 *     `server_error` (ответ без понятного кода), `aborted`.
 */
export type UploadServerError = UploadRejection | 'storage_unavailable' | 'bad_request' | 'not_found' | 'not_uploaded'
export type UploadErrorCode =
  | UploadServerError
  | 'network'
  | 'storage_rejected'
  | 'rate_limited'
  | 'unauthorized'
  | 'server_error'
  | 'aborted'
