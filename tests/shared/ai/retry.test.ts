import { describe, expect, it } from 'vitest'
import { retryPlan } from '@/shared/ai/retry'

/**
 * Правило «что делать с упавшим вызовом». До него было два крайних поведения: совет повторял
 * ТУ ЖЕ модель на любой транзиентной ошибке, а одиночная генерация не повторяла вовсе — упало,
 * записали исход, вернули null. Здесь зафиксировано различение, ради которого правило и заведено.
 */
describe('retryPlan', () => {
  it('перегрузка, таймаут и сеть — повторить ту же модель', () => {
    expect(retryPlan(new Error('429 Too Many Requests'))).toBe('same')
    expect(retryPlan(new Error('503 Service Unavailable'))).toBe('same')
    expect(retryPlan(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))).toBe('same')
    expect(retryPlan(new Error('fetch failed'))).toBe('same')
    expect(retryPlan(new Error('ECONNRESET'))).toBe('same')
  })

  it('отказ САМОЙ модели — брать другую, а не долбить эту', () => {
    // Ровно та ошибка, которой отвечает снятая с обслуживания модель (аудит 2026-08-01).
    expect(retryPlan(new Error('404 No endpoints found for anthropic/claude-3.5-haiku'))).toBe('other')
    expect(retryPlan(new Error('model not found'))).toBe('other')
    expect(retryPlan(new Error('This model is decommissioned'))).toBe('other')
    expect(retryPlan(new Error('maximum context length exceeded'))).toBe('other')
  })

  it('ключ, деньги, политика — прекратить: другая модель не спасёт', () => {
    expect(retryPlan(new Error('401 Invalid API key'))).toBe('stop')
    expect(retryPlan(new Error('402 insufficient credits'))).toBe('stop')
    expect(retryPlan(new Error('403 content policy violation'))).toBe('stop')
  })

  it('безнадёжное правило важнее транзиентного: «402 insufficient credits» не повторяем', () => {
    // В тексте есть и цифры, и слово про лимит — порядок проверок обязан оставаться прежним.
    expect(retryPlan(new Error('402 quota exceeded, rate limit reached'))).toBe('stop')
  })

  it('неизвестная ошибка — одна попытка ДРУГОЙ моделью, а не повтор той же', () => {
    expect(retryPlan(new Error('something odd happened'))).toBe('other')
    expect(retryPlan('строка вместо ошибки')).toBe('other')
  })

  it('причина из cause тоже читается (undici прячет настоящую ошибку там)', () => {
    const e = Object.assign(new Error('fetch failed'), { cause: new Error('ECONNREFUSED 45.152.22.222:443') })
    expect(retryPlan(e)).toBe('same')
  })
})
