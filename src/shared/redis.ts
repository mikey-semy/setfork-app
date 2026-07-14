import 'server-only'
import Redis from 'ioredis'
import { captureError } from './observability'

// Общий Redis-клиент для мульти-инстансных сторов (театр совета, уточнения диалога).
// Задан REDIS_URL → один общий клиент на процесс; иначе null → сторы падают на in-memory (дефолт
// на одном инстансе). Ошибки соединения не роняют сайт (fail-open, как в rate-limit-store).
declare global {
  var __redis: Redis | null | undefined
}

export function getRedis(): Redis | null {
  if (globalThis.__redis !== undefined) return globalThis.__redis
  const url = process.env.REDIS_URL
  if (!url) return (globalThis.__redis = null)
  const client = new Redis(url, { maxRetriesPerRequest: 2, enableOfflineQueue: false })
  client.on('error', (e) => captureError(e, { where: 'redis.conn' }))
  return (globalThis.__redis = client)
}
