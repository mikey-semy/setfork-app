import 'server-only'
import { gunzipSync } from 'node:zlib'
import { envNumber } from '@/shared/env'

/**
 * Тело git smart-HTTP запроса: прочитать с потолком и, если клиент сжал, распаковать.
 *
 * Живёт отдельным файлом, потому что это ЕДИНСТВЕННОЕ, что осталось от прежней
 * TS-реализации smart-HTTP: сам протокол теперь обслуживает ядро, а роут только
 * подаёт ему тело запроса.
 *
 * Ф0 (хвост). До этого тело читалось целиком через `req.arrayBuffer()` без единой
 * проверки размера, и дыры было две, а не одна:
 *
 *  1. пуш любого размера сначала полностью оказывался в памяти Node и только
 *     потом упирался в потолок ядра — то есть потолок ядра защищал ядро, но не
 *     фронт;
 *  2. `gunzipSync` распаковывал без ограничения. Проверено на живом Node: 4.9 КБ
 *     сжатых данных разворачиваются в 5 МБ, а на однородных данных коэффициент
 *     на порядки выше — сжатое тело в пределах любого разумного лимита могло
 *     съесть память целиком.
 *
 * Потолок здесь СВОЙ, а не общий с ядром (`SETFORK_MAX_RECV_MB`): это разные
 * границы — продуктовая и транспортная. Отдельная переменная позволяет держать
 * фронтовую строго ниже, чтобы отказ приходил раньше, с понятным текстом, не
 * тратя ни памяти, ни сетевого плеча до ядра.
 */

/**
 * Потолок тела git-запроса, байты (SETFORK_GIT_MAX_BODY_MB, деф. 32 МБ).
 *
 * `0` = БЕЗ ОГРАНИЧЕНИЯ — то же значение нуля, что у потолков ядра
 * (`SETFORK_MAX_PACK_MB`, `SETFORK_REPO_LIMIT_MB`). Одно соглашение на проект:
 * оператор, выключающий потолок привычным способом, не должен получить вместо
 * этого «отвергать всё». Без этого ноль давал потолок 0 байт: несжатый запрос
 * получал 413 на пустом месте, а сжатый уходил в `gunzipSync` с
 * `maxOutputLength: 0`, где Node бросает ERR_OUT_OF_RANGE, — и вместо 413
 * приходил 500 (авто-ревью fe#649).
 *
 * Округляем вниз: настройка в мегабайтах, а байты дробными не бывают. Значение
 * меньше байта, но не ноль — это опечатка, а не «выключено»: оставляем байт,
 * чтобы намерение «ограничить» не превратилось в свою противоположность.
 */
export function gitBodyMaxBytes(): number {
  const mb = envNumber('SETFORK_GIT_MAX_BODY_MB', 32)
  if (mb === 0) return Number.POSITIVE_INFINITY
  return Math.max(1, Math.floor(mb * 1024 * 1024))
}

/** Тело больше потолка: роут отвечает на неё 413, а не 500. */
export class GitBodyTooLarge extends Error {
  constructor(readonly maxBytes: number) {
    super(`git body exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`)
    this.name = 'GitBodyTooLarge'
  }
}

/**
 * Прочитать тело запроса, не дав ему превысить потолок.
 *
 * Заголовку `Content-Length` верим только для БЫСТРОГО отказа: он позволяет не
 * читать заведомо большое тело вовсе. Но полагаться на него нельзя — git вправе
 * слать `Transfer-Encoding: chunked`, и тогда заголовка нет совсем, а соврать в
 * нём может кто угодно. Поэтому считаем и байты по мере чтения.
 */
export async function readGitBody(req: Request, maxBytes = gitBodyMaxBytes()): Promise<Buffer> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new GitBodyTooLarge(maxBytes)

  const stream = req.body
  if (!stream) return Buffer.alloc(0)
  const reader = stream.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      // Обрываем НА превышении, а не после: весь смысл потолка в том, чтобы
      // лишние байты не оказались в памяти.
      if (total > maxBytes) throw new GitBodyTooLarge(maxBytes)
      chunks.push(Buffer.from(value))
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks)
}

/**
 * Распаковать, если клиент сжал: git-клиент вправе сжать POST, и без распаковки
 * ядро получило бы бинарный мусор вместо pkt-line.
 *
 * Потолок распакованного — тот же самый: сжатие не должно быть способом его
 * обойти.
 */
export function maybeGunzip(body: Buffer, contentEncoding: string | null, maxBytes = gitBodyMaxBytes()): Buffer {
  if (!contentEncoding?.includes('gzip')) return body
  try {
    // Потолок выключен — не передаём опцию вовсе: zlib и так упрётся в свой
    // предел буфера. Подсунуть ему бесконечность значило бы получить не «без
    // ограничения», а ошибку типа.
    if (!Number.isFinite(maxBytes)) return gunzipSync(body)
    return gunzipSync(body, { maxOutputLength: maxBytes })
  } catch (e) {
    // ERR_BUFFER_TOO_LARGE — это превышение потолка, а не битые данные: отвечаем
    // 413, как и на несжатое большое тело. Остальные ошибки пусть падают.
    if ((e as NodeJS.ErrnoException)?.code === 'ERR_BUFFER_TOO_LARGE') throw new GitBodyTooLarge(maxBytes)
    throw e
  }
}
