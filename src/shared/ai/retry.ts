/**
 * ЧТО ДЕЛАТЬ С УПАВШИМ ВЫЗОВОМ — чистое правило, отдельно от места вызова.
 *
 * До него у нас было два крайних поведения: совет ретраил ТУ ЖЕ модель на любой транзиентной
 * ошибке, а одиночная генерация не ретраила вовсе — упало, записали исход, вернули null. Оба
 * не различали главного: бывают отказы, где та же модель через секунду ответит (таймаут, 429,
 * 5xx), бывают отказы САМОЙ МОДЕЛИ (её сняли с обслуживания, контекст не влез) — там нужна
 * другая модель, а не повтор, — и бывают отказы, где не поможет ничего (ключ, деньги, политика).
 *
 * Классификация по тексту ошибки, а не по типу: провайдеры прилетают через разные слои
 * (AI SDK, undici, наш fetch), и единственное общее у них — сообщение и код в нём.
 */

export type RetryPlan =
  /** Повторить ТУ ЖЕ модель: перегрузка, таймаут, сеть. */
  | 'same'
  /** Взять ДРУГУЮ модель: эта снята с обслуживания или не подходит под запрос. */
  | 'other'
  /** Прекратить: ключ, деньги, политика — другая модель не спасёт. */
  | 'stop'

const TRANSIENT = /\b(429|500|502|503|504)\b|timeout|timed out|abort|econnreset|etimedout|socket|fetch failed|network|overloaded|rate.?limit/i
const MODEL_FAULT = /\b(404|400)\b|no endpoints|not found|does not exist|decommissioned|deprecated|unsupported|context length|maximum context|too many tokens/i
const HOPELESS = /\b(401|402|403)\b|invalid api key|no auth|insufficient credit|quota exceeded|billing|moderation|content policy/i

export function retryPlan(e: unknown): RetryPlan {
  const msg = e instanceof Error ? `${e.name} ${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : String(e)
  // Порядок проверок значим: «402 insufficient credits» содержит и цифры, и слово про лимит,
  // но повторять его бессмысленно — безнадёжное правило идёт первым.
  if (HOPELESS.test(msg)) return 'stop'
  if (MODEL_FAULT.test(msg)) return 'other'
  if (TRANSIENT.test(msg)) return 'same'
  // Неизвестная ошибка: пробуем другую модель ОДИН раз (список кандидатов конечен), а не
  // повторяем ту же — повтор неизвестного отказа чаще всего даёт тот же отказ и удваивает цену.
  return 'other'
}
