// Минимальный Sentry-клиент без SDK. Если задан SENTRY_DSN — шлём событие
// напрямую в envelope-эндпоинт обычным fetch. Best-effort, fire-and-forget:
// провал отправки НИКОГДА не должен ломать основной поток (и не логируем повторно,
// чтобы не зациклиться через captureError). Работает и в node, и в edge-runtime.

export interface ParsedDsn {
  endpoint: string
  publicKey: string
}

/** DSN вида https://KEY@host/PROJECT → endpoint .../api/PROJECT/envelope/. */
export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn)
    const publicKey = u.username
    if (!publicKey) return null
    const segs = u.pathname.split('/').filter(Boolean)
    const projectId = segs.pop()
    if (!projectId) return null
    const prefix = segs.length ? '/' + segs.join('/') : ''
    return { endpoint: `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/`, publicKey }
  } catch {
    return null
  }
}

/** Sentry envelope = 3 строки NDJSON: заголовок, заголовок item, payload. */
export function buildEnvelope(eventId: string, sentAt: string, event: Record<string, unknown>): string {
  const header = JSON.stringify({ event_id: eventId, sent_at: sentAt })
  const itemHeader = JSON.stringify({ type: 'event' })
  return `${header}\n${itemHeader}\n${JSON.stringify(event)}\n`
}

export function isSentryEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN)
}

/** Отправить ошибку в Sentry (если настроен). Ничего не бросает и не ждёт ответа. */
export function reportToSentry(err: Error, ctx?: Record<string, unknown>): void {
  try {
    const dsn = process.env.SENTRY_DSN
    if (!dsn) return
    const parsed = parseDsn(dsn)
    if (!parsed) return

    const eventId = crypto.randomUUID().replace(/-/g, '')
    const nowIso = new Date().toISOString()
    const event: Record<string, unknown> = {
      event_id: eventId,
      timestamp: new Date(nowIso).getTime() / 1000,
      platform: 'node',
      level: 'error',
      environment: process.env.NODE_ENV ?? 'development',
      server_name: process.env.HOSTNAME || undefined,
      release: process.env.SENTRY_RELEASE || undefined,
      exception: { values: [{ type: err.name, value: err.message }] },
      extra: { ...ctx, stack: err.stack },
    }
    const auth = `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=setfork/1.0`
    void fetch(parsed.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': auth },
      body: buildEnvelope(eventId, nowIso, event),
    }).catch(() => {})
  } catch {
    // проглатываем: телеметрия не должна влиять на приложение
  }
}
