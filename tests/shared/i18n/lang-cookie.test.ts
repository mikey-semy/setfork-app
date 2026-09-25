import { describe, expect, it } from 'vitest'
import { LANG_COOKIE, LANG_COOKIE_OPTIONS, langCookieString } from '@/shared/i18n'

/**
 * Куку языка пишут двое — переключатель в шапке и middleware (переход со старого `/ru/…`).
 * Атрибуты у них обязаны совпадать: иначе выбор, сделанный одним, другой перезаписывал бы
 * с другим сроком, а без `SameSite` Firefox и Safari не считают её `Lax`.
 */
describe('кука языка в браузере', () => {
  it('та же кука, что пишет middleware: путь, год, Lax', () => {
    const s = langCookieString('ru')
    expect(s.startsWith(`${LANG_COOKIE}=ru;`)).toBe(true)
    expect(s).toContain(`path=${LANG_COOKIE_OPTIONS.path}`)
    expect(s).toContain(`max-age=${LANG_COOKIE_OPTIONS.maxAge}`)
    expect(s).toContain('samesite=lax')
  })
})
