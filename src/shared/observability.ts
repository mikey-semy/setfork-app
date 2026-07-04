// Единая наблюдаемость: структурный логгер + choke-point для ошибок.
// В prod пишем JSON-строкой (легко парсить сборщику логов), в dev — читаемо.
// `captureError` — ЕДИНАЯ точка: структурный error-лог со стеком + отправка во
// внешний трекер (Sentry) по DSN, если он задан (см. shared/sentry).

import { reportToSentry } from './sentry'

type Level = 'info' | 'warn' | 'error'
const isProd = process.env.NODE_ENV === 'production'

function emit(level: Level, msg: string, ctx?: Record<string, unknown>): void {
  const hasCtx = ctx && Object.keys(ctx).length > 0
  const line = isProd
    ? JSON.stringify({ level, msg, time: new Date().toISOString(), ...ctx })
    : `[${level}] ${msg}${hasCtx ? ' ' + JSON.stringify(ctx) : ''}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = {
  info: (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
}

/**
 * Логирует ошибку структурно (со стеком) и передаёт её внешнему трекеру, если он
 * подключён. `where` — короткий ярлык места (напр. 'jobs.handle', 'notify').
 * Место для интеграции Sentry: добавить `Sentry.captureException(e, {extra:ctx})`
 * здесь — все ошибки уже проходят через эту функцию.
 */
export function captureError(err: unknown, ctx?: Record<string, unknown>): void {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Unknown error')
  emit('error', e.message, { ...ctx, errorName: e.name, stack: e.stack })
  reportToSentry(e, ctx)
}
