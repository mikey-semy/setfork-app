import { describe, expect, it } from 'vitest'
import { emailButton, emailHint, renderEmail } from '@/shared/email/layout'
import { fill, t } from '@/shared/i18n'
import { legalUrl } from '@/shared/docs'

// Подвал писем — то же, что подвал сайта. Тест держит договор: письмо без
// подвала собрать нельзя, а пользовательские данные в нём экранированы.

describe('обёртка письма', () => {
  it('добавляет подвал сайта на языке получателя', () => {
    const html = renderEmail({ lang: 'ru', body: '<p>тело</p>' })
    expect(html).toContain('тело')
    expect(html).toContain(t('terms', 'ru'))
    expect(html).toContain(t('privacy', 'ru'))
    expect(html).toContain(legalUrl('terms', 'ru'))
    expect(html).toContain(`© ${new Date().getFullYear()} SetFork`)
  })

  it('ставит язык подвала по получателю, а не по серверу', () => {
    expect(renderEmail({ lang: 'en', body: '' })).toContain(t('terms', 'en'))
    expect(renderEmail({ lang: 'en', body: '' })).toContain(legalUrl('privacy', 'en'))
  })

  it('печатает «почему письмо пришло» только когда причина задана', () => {
    const note = t('emailFooter', 'ru')
    expect(renderEmail({ lang: 'ru', body: '', note })).toContain(note)
    expect(renderEmail({ lang: 'ru', body: '' })).not.toContain(note)
  })

  it('ставит отписку в ВИДИМЫЙ подвал, а не только в заголовок письма', () => {
    const url = 'https://setfork.com/api/unsubscribe?token=abc'
    const bulk = renderEmail({ lang: 'ru', body: '', unsubscribeUrl: url })

    expect(bulk).toContain(url)
    expect(bulk).toContain(t('unsubscribe.action', 'ru'))
    // Служебному письму отписка не положена — её не должно быть и в подвале.
    expect(renderEmail({ lang: 'ru', body: '' })).not.toContain(t('unsubscribe.action', 'ru'))
  })

  it('подставляет значения буквально, даже со спецсимволами замены', () => {
    // String.replace раскрывает $&, $1 и подобное — в нике или адресе это ломает текст.
    expect(fill('email.verifyBody', 'en', { handle: 'a$&b' })).toContain('a$&b')
    expect(fill('email.changeNoticeBody', 'ru', { handle: 'u', email: 'x$`y@example.org' })).toContain('x$`y@example.org')
  })

  it('экранирует данные в кнопке и приписке', () => {
    const html = emailButton('https://setfork.com/x?a=1&b=2', '<b>Открыть</b>') + emailHint('5 > 3 & <script>')
    expect(html).not.toContain('<b>Открыть</b>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&amp;')
  })

  it('повторяет адрес текстом — часть клиентов вырезает кнопки', () => {
    const url = 'https://setfork.com/verify-email?token=abc'
    const html = emailButton(url, 'Verify')
    expect(html.split(url).length - 1).toBe(2) // в href и отдельной строкой
  })
})
