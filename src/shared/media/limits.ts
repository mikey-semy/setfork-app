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

/** Аватар: после кадрирования это квадрат 512px (AvatarCropper) — заведомо меньше;
 *  предел держит то, что пришло в экшен профиля в обход кадрирования. Одно число на
 *  дропзону и на сервер (avatar.ts), раньше жило двумя копиями. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

/** Форматы картинок, которые сервер распознаёт по сигнатуре (см. sniffImage). Тот же
 *  список — в `accept` поля выбора.
 *
 *  Про HEIC на iOS: галерея (PHPicker) в WebKit и так отдаёт «совместимое»
 *  представление — HEIC перекодирован в JPEG — при ЛЮБОМ `accept`. Явный список важен
 *  лишь при внутренней настройке PhotoPickerPrefersOriginalImageFormat (WebKit,
 *  WKFileUploadPanel.mm): тогда с `image/*` пришёл бы HEIC как есть, и сервер его
 *  отверг бы. Список оставлен как безопасный при любой настройке. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

export type ImageType = (typeof IMAGE_TYPES)[number]

/** Расширение файла по типу — одно место на сервер (имя в хранилище) и клиент (имя
 *  файла после уменьшения или кадрирования). */
export const IMAGE_EXT: Record<ImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** Тип из списка допустимых — или null. Сужение для таблиц по типу. */
export function asImageType(type: string): ImageType | null {
  return (IMAGE_TYPES as readonly string[]).includes(type) ? (type as ImageType) : null
}

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
  if (file.type && !asImageType(file.type)) return 'bad_type'
  return null
}
