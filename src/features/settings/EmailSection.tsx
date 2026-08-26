'use client'

import { useActionState, useState, useTransition } from 'react'
import { MailCheck, MailWarning, Pencil, Send } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import type { Lang } from '@/shared/i18n'
import { requestEmailChange, resendVerification, type EmailChangeResult } from '@/features/auth/email-flows'

function changeError(err: Exclude<EmailChangeResult, { ok: true }>['error'], ru: boolean): string {
  const en: Record<typeof err, string> = {
    invalid: 'Enter a valid email address.',
    same: 'That’s already your current address.',
    taken: 'This address is attached to another account.',
    throttled: 'Too many attempts — try again later.',
    'no-email': 'No email to change (GitHub sign-in).',
    smtp: 'Couldn’t send the email (SMTP not configured?).',
  }
  const rus: Record<typeof err, string> = {
    invalid: 'Введи корректный адрес почты.',
    same: 'Это и есть твой текущий адрес.',
    taken: 'Этот адрес привязан к другому аккаунту.',
    throttled: 'Слишком много попыток — попробуй позже.',
    'no-email': 'Менять нечего (вход через GitHub).',
    smtp: 'Не удалось отправить письмо (SMTP не настроен?).',
  }
  return (ru ? rus : en)[err]
}

/** Настройки → Email: адрес, статус подтверждения, переотправка письма. */
export function EmailSection({ email, verified, lang }: { email: string | null; verified: boolean; lang: Lang }) {
  const ru = lang === 'ru'
  const [sent, setSent] = useState<boolean | null>(null)
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const [state, formAction, changing] = useActionState<EmailChangeResult | null, FormData>(
    (_prev, fd) => requestEmailChange(_prev, fd),
    null,
  )

  if (!email) {
    return (
      <p className="text-body text-ink-2">
        {ru ? 'Почта не привязана (вход через GitHub).' : 'No email attached (GitHub sign-in).'}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-body text-ink">{email}</span>
        {verified ? (
          <Badge variant="ok">
            <MailCheck size={11} /> {ru ? 'подтверждена' : 'verified'}
          </Badge>
        ) : (
          <Badge className="border-warn/50 text-warn">
            <MailWarning size={11} /> {ru ? 'не подтверждена' : 'unverified'}
          </Badge>
        )}
      </div>
      {!verified && (
        <div className="flex items-center gap-3">
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await resendVerification()
                setSent(r.sent)
              })
            }
          >
            <Send size={13} /> {ru ? 'Отправить письмо ещё раз' : 'Resend verification email'}
          </Button>
          {sent === true && <span className="text-body-sm text-ok">{ru ? 'Отправлено' : 'Sent'}</span>}
          {sent === false && (
            <span className="text-body-sm text-warn">
              {ru ? 'Не удалось (SMTP не настроен?)' : 'Failed (SMTP not configured?)'}
            </span>
          )}
        </div>
      )}

      {/* Смена адреса: письмо-подтверждение уходит на НОВЫЙ адрес. */}
      {state?.ok ? (
        <p className="text-body text-ok">
          {ru
            ? 'Письмо для подтверждения отправлено на новый адрес. Старый остаётся активным, пока не перейдёшь по ссылке.'
            : 'A confirmation email was sent to the new address. The old one stays active until you follow the link.'}
        </p>
      ) : editing ? (
        <form action={formAction} className="flex flex-col gap-2 border-t border-border pt-3">
          <label className="text-body-sm text-ink-2" htmlFor="new-email">
            {ru ? 'Новый адрес почты' : 'New email address'}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input id="new-email" name="email" type="email" required placeholder="you@example.com" className="max-w-[17.5rem]" />
            <Button type="submit" disabled={changing}>
              {ru ? 'Отправить подтверждение' : 'Send confirmation'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={changing}>
              {ru ? 'Отмена' : 'Cancel'}
            </Button>
          </div>
          {state && !state.ok && <span className="text-body-sm text-danger">{changeError(state.error, ru)}</span>}
        </form>
      ) : (
        <div>
          <Button variant="ghost" onClick={() => setEditing(true)}>
            <Pencil size={13} /> {ru ? 'Сменить адрес' : 'Change email'}
          </Button>
        </div>
      )}
    </div>
  )
}
