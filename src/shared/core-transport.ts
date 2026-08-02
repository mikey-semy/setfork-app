import 'server-only'
import { createGrpcTransport } from '@connectrpc/connect-node'
import type { Interceptor, Transport } from '@connectrpc/connect'

// Единый транспорт к Rust-ядру (h2c внутри docker-сети) с авторизацией канала:
// SETFORK_CORE_TOKEN задан → каждый RPC несёт `authorization: Bearer <token>`
// (ядро проверяет интерцептором; health-проба остаётся открытой).
// Токен не задан → как раньше (локальный dev без авторизации).

const auth: Interceptor = (next) => async (req) => {
  const token = process.env.SETFORK_CORE_TOKEN
  if (token) req.header.set('authorization', `Bearer ${token}`)
  return next(req)
}

/** Транспорт к ядру. addr — SETFORK_CORE_ADDR (по умолчанию локальный dev-сервер). */
export function coreTransport(): Transport {
  const addr = process.env.SETFORK_CORE_ADDR ?? '127.0.0.1:50051'
  return createGrpcTransport({ baseUrl: `http://${addr}`, interceptors: [auth] })
}

/**
 * Потолок ожидания ответа на пуш зеркала, мс (SETFORK_MIRROR_PUSH_TIMEOUT_SEC,
 * деф. 90с).
 *
 * ⚠️ Общего дедлайна у транспорта НЕТ и не должно быть: клон и пуш длинного
 * репозитория идут минутами, любой общий потолок рвал бы их. А вот пуш зеркала
 * ограничен по смыслу — внутри ядра у самого `git push` таймаут 60с, и ответ
 * обязан прийти вскоре после. Без дедлайна ядро, принявшее соединение и не
 * ответившее, вешало вызов навсегда (авто-ревью fe#645).
 *
 * Живёт в shared, а не рядом с вызовом, потому что нужен двоим и в разных
 * фичах: клиенту ядра (ставит дедлайн) и подметальщику зеркал (обязан не
 * начинать вызов, на который у него уже не осталось времени). Два чтения одной
 * env разъехались бы молча, а импорт фичи из фичи запрещён границами слоёв.
 */
export const mirrorPushTimeoutMs = (): number =>
  (Number(process.env.SETFORK_MIRROR_PUSH_TIMEOUT_SEC) || 90) * 1000
