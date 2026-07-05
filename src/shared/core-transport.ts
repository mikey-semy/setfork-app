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
