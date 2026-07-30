import 'server-only'
import { gunzipSync } from 'node:zlib'

/**
 * Тело git smart-HTTP запроса: git-клиент вправе сжать POST, и без распаковки
 * ядро получило бы бинарный мусор вместо pkt-line.
 *
 * Живёт отдельным файлом, потому что это ЕДИНСТВЕННОЕ, что осталось от прежней
 * TS-реализации smart-HTTP: сам протокол теперь обслуживает ядро, а роут только
 * подаёт ему тело запроса.
 */
export function maybeGunzip(body: Buffer, contentEncoding: string | null): Buffer {
  return contentEncoding && contentEncoding.includes('gzip') ? gunzipSync(body) : body
}
