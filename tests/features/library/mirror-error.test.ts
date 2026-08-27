import { describe, expect, it } from 'vitest'
import { mirrorErrorText } from '@/features/library/mirror-error'

/**
 * КОД ОТ ЯДРА ПЕРЕВОДИТСЯ, ВЫВОД GIT — НЕТ.
 *
 * Решение И1: ядро отдаёт машинный код, текст подбирает фронт по языку человека.
 * До 26.08.2026 ядро слало готовую русскую прозу — и она же уезжала в английский
 * интерфейс. Здесь проверяется обе стороны договорённости сразу, потому что вторая
 * (не переводить чужой вывод) ломается ровно так же легко: достаточно «на всякий
 * случай» подменить неизвестную строку общим «не удалось», и владелец останется без
 * единственной подсказки о том, что не так с его токеном.
 */
describe('текст отказа зеркала', () => {
  it('известный код становится текстом на языке человека', () => {
    expect(mirrorErrorText('not-configured', 'ru')).toContain('не настроено')
    expect(mirrorErrorText('not-configured', 'en')).toContain('not configured')
    expect(mirrorErrorText('secret-missing', 'ru')).toContain('ключ шифрования')
    expect(mirrorErrorText('token-undecryptable', 'ru')).toContain('Введите токен заново')
  })

  it('вывод git показывается как есть', () => {
    for (const raw of ['remote: Repository not found.', 'fatal: Authentication failed', '']) {
      expect(mirrorErrorText(raw, 'ru')).toBe(raw)
      expect(mirrorErrorText(raw, 'en')).toBe(raw)
    }
  })

  it('код без перевода не превращается в пустоту', () => {
    expect(mirrorErrorText('unknown-code-from-future-core', 'ru')).toBe('unknown-code-from-future-core')
  })
})
