import { Code, ConnectError } from '@connectrpc/connect'
import { GitTransportError } from '@/core'

/**
 * Отказ операции smart-HTTP → типизированная ошибка транспорта.
 *
 * Отдельным модулем, а не строкой внутри адаптера: адаптер целиком мокается в
 * тестах роута, и правило раскладки gRPC-кодов оставалось бы непроверенным —
 * ровно та слепота, из-за которой ошибки ядра и уходили мимо роута (карточка 007).
 *
 * Разбирается только код gRPC. Текст сообщения НЕ трогаем: угадывание причины по
 * подстроке уже было проблемой у ветковых операций, и его там сознательно убрали.
 */
export function toTransportError(e: unknown, op: string): GitTransportError {
  if (!(e instanceof ConnectError)) return new GitTransportError('internal', op, { cause: e })
  if (e.code === Code.Unavailable) return new GitTransportError('unavailable', op, { cause: e })
  if (e.code === Code.DeadlineExceeded) return new GitTransportError('timeout', op, { cause: e })
  if (e.code === Code.NotFound) return new GitTransportError('not-found', op, { cause: e })
  return new GitTransportError('internal', op, { cause: e })
}
