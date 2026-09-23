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
