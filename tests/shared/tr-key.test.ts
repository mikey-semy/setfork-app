import { describe, expect, it } from 'vitest'
import { tr, trKey } from '@/shared/i18n'

// trKey обязан называть ТОТ ЖЕ ключ, из которого tr() берёт значение: правка,
// положенная в другой ключ, обновит один перевод, а наружу продолжит отдаваться
// прежний — API отвечает успехом, а изменения не видно.
describe('trKey — куда ложится правка «поверх прочитанного»', () => {
  const cases = [
    { lt: { en: 'old', ru: 'старое' }, lang: 'en' as const },
    { lt: { en: 'old', ru: 'старое' }, lang: 'ru' as const },
    { lt: { ru: 'только русский' }, lang: 'en' as const },
    { lt: { en: '', ru: 'русский' }, lang: 'en' as const },
    { lt: { en: 'англ' }, lang: 'ru' as const },
  ]
  it('ключ совпадает с тем, что вернул tr', () => {
    for (const { lt, lang } of cases) {
      const key = trKey(lt, lang)
      expect(key, JSON.stringify({ lt, lang })).toBeDefined()
      expect((lt as Record<string, string>)[key as string]).toBe(tr(lt, lang))
    }
  })
  it('пусто — ключа нет', () => {
    expect(trKey({}, 'en')).toBeUndefined()
    expect(trKey(null, 'ru')).toBeUndefined()
    expect(trKey({ en: '' }, 'en')).toBeUndefined()
  })
})
