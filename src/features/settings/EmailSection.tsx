'use client'

import { useState, useTransition } from 'react'
import { MailCheck, MailWarning, Send } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import type { Lang } from '@/shared/i18n'
import { resendVerification } from '@/features/auth/email-flows'

/** Настройки → Email: адрес, статус подтверждения, переотправка письма. */
export function EmailSection({ email, verified, lang }: { email: string | null; verified: boolean; lang: Lang }) {
  const ru = lang === 'ru'
  const [sent, setSent] = useState<boolean | null>(null)
  const [pending, start] = useTransition()

  if (!email) {
    return (
      <p className="text-[13.5px] text-ink-2">
        {ru ? 'Почта не привязана (вход через GitHub).' : 'No email attached (GitHub sign-in).'}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13.5px] text-ink">{email}</span>
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
          {sent === true && <span className="text-[12.5px] text-ok">{ru ? 'Отправлено' : 'Sent'}</span>}
          {sent === false && (
            <span className="text-[12.5px] text-warn">
              {ru ? 'Не удалось (SMTP не настроен?)' : 'Failed (SMTP not configured?)'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
