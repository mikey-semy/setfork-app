import { DIG_MAX_LEVEL } from '@/shared/ai/dig'

// ⚠️ ОТДЕЛЬНЫМ МОДУЛЕМ, а не рядом с экшенами: файл действий помечен 'use server', и
// каждый его экспорт обязан быть async — синхронная функция роняет СБОРКУ («Server
// Actions must be async functions»). Типы, линт и тесты этого не ловят.

/**
 * Какой слой копаем сейчас: по числу уже сказанного гномом в этой ветке.
 *
 * Считаем ЕГО реплики, а не все: вопрос без ответа (сбой, отказ по бюджету) не должен
 * уводить разговор глубже, чем человек на самом деле спустился. Ниже последнего уровня
 * лестницы не опускаемся — дальше глубина не растёт, растёт болтовня.
 */
export function digDepth(history: Array<{ role: string }>): number {
  const answered = history.filter((m) => m.role !== 'user').length
  return Math.min(answered + 1, DIG_MAX_LEVEL)
}
