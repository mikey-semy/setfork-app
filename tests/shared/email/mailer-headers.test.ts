import { beforeEach, describe, expect, it, vi } from 'vitest'

// Заголовки List-Unsubscribe — договор с Gmail/Yahoo: без них массовая почта
// теряет доверие. Проверяем, что они уходят у рассылок и НЕ уходят у служебных
// писем (отписка от подтверждения адреса или сброса пароля недопустима).

const sent: Array<Record<string, unknown>> = []

vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (msg: Record<string, unknown>) => {
        sent.push(msg)
      },
    }),
  },
}))

vi.mock('@/shared/settings/email', () => ({
  getEmailSettings: async () => ({ host: 'mail.example.org', port: 465, secure: true, user: '', pass: '', from: 'SetFork <no-reply@example.org>', notifyTo: '' }),
}))

describe('заголовки письма', () => {
  beforeEach(() => {
    sent.length = 0
  })

  it('ставит One-Click отписку, когда адрес отписки передан', async () => {
    const { sendMail } = await import('@/shared/email/mailer')
    const url = 'https://setfork.com/api/unsubscribe?token=abc'

    expect(await sendMail({ to: 'a@example.org', subject: 'Digest', body: '<p>x</p>', lang: 'en', unsubscribeUrl: url })).toBe(true)
    expect(sent[0].headers).toEqual({
      'List-Unsubscribe': `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })

  it('не ставит их служебному письму', async () => {
    const { sendMail } = await import('@/shared/email/mailer')

    await sendMail({ to: 'a@example.org', subject: 'Verify', body: '<p>x</p>', lang: 'en' })
    expect(sent[0].headers).toBeUndefined()
  })

  it('шлёт письмо в двух частях: html с подвалом и текстовую', async () => {
    const { sendMail } = await import('@/shared/email/mailer')

    await sendMail({ to: 'a@example.org', subject: 'Digest', body: '<p>тело</p>', lang: 'ru' })
    expect(String(sent[0].html)).toContain('SETFORK')
    expect(String(sent[0].text)).toContain('тело')
  })

  it('сохраняет адреса ссылок в текстовой части — иначе отписаться из неё нельзя', async () => {
    const { sendMail } = await import('@/shared/email/mailer')
    const url = 'https://setfork.com/api/unsubscribe?token=abc&x=1'

    await sendMail({ to: 'a@example.org', subject: 'Digest', body: '<p>x</p>', lang: 'ru', unsubscribeUrl: url })
    const text = String(sent[0].text)
    expect(text).toContain(url) // и целиком, без &amp;
    expect(text).toContain(`Отписаться (${url})`)
  })
})
