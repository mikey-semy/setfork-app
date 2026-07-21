import { describe, expect, it } from 'vitest'
import { humanModerationReason } from '@/features/moderation/reason'

// Формы причин порождают automation.ts (routeVerdict, checkSpamHeuristics) и
// moderate-list.ts (re-upload, budget) — тест держит маппинг в синхроне с ними.
describe('humanModerationReason', () => {
  it('AI uncertain → человеческая фраза без процентов и диагностики', () => {
    const raw = 'AI uncertain (0%): classifier returned no valid verdict — needs human review'
    expect(humanModerationReason(raw, 'ru')).toBe('автопроверка не уверена — посмотрит модератор')
    expect(humanModerationReason(raw, 'en')).toContain('moderator')
  })

  it('спам-эвристики переводятся по каждой форме', () => {
    expect(humanModerationReason('spam heuristic: empty list (no steps)', 'ru')).toBe('в списке нет пунктов')
    expect(humanModerationReason('spam heuristic: no meaningful title', 'ru')).toBe('нет осмысленного названия')
    expect(humanModerationReason('spam heuristic: url shortener (bit.ly)', 'ru')).toBe('ссылки через сокращатели запрещены')
    expect(humanModerationReason('spam heuristic: link farm (14 distinct hosts)', 'ru')).toBe('слишком много ссылок на разные сайты')
  })

  it('уверенный AI-флаг сохраняет категорию', () => {
    expect(humanModerationReason('AI [S9]: instructions for weapons', 'ru')).toBe('автопроверка увидела возможное нарушение (S9)')
  })

  it('re-upload и исчерпанный бюджет', () => {
    expect(humanModerationReason('Re-upload of previously removed content', 'ru')).toBe('совпадает с ранее удалённым контентом')
    expect(humanModerationReason('AI budget exhausted — awaiting manual review', 'ru')).toBe('ждёт ручной проверки модератором')
  })

  it('незнакомый текст (написан админом руками) возвращается как есть', () => {
    expect(humanModerationReason('Снято по жалобе правообладателя', 'ru')).toBe('Снято по жалобе правообладателя')
  })
})
