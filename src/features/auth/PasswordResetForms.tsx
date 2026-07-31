'use client'

import { useActionState } from 'react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Alert } from '@/shared/ui/Alert'
import type { Lang } from '@/shared/i18n'
import { performPasswordReset, requestPasswordReset } from './email-flows'

export function ForgotPasswordForm({ lang }: { lang: Lang }) {
  const ru = lang === 'ru'
  const [state, action, pending] = useActionState(requestPasswordReset, null)
  if (state?.done) {
    return (
      <Alert variant="ok">
        {ru
          ? 'Если такой аккаунт существует — письмо со ссылкой уже в пути. Проверь почту (и спам).'
          : 'If that account exists, an email with the link is on its way. Check your inbox (and spam).'}
      </Alert>
    )
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <Input name="email" type="email" required placeholder="you@example.com" autoComplete="email" autoFocus />
      <Button type="submit" variant="primary" size="md" disabled={pending} className="w-full py-2.5">
        {ru ? 'Отправить ссылку' : 'Send reset link'}
      </Button>
    </form>
  )
}

export function ResetPasswordForm({ token, lang }: { token: string; lang: Lang }) {
  const ru = lang === 'ru'
  const [state, action, pending] = useActionState(performPasswordReset, null)
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      {state?.error && (
        <Alert variant="danger">
          {state.error === 'short'
            ? ru ? 'Пароль короче 8 символов.' : 'Password must be at least 8 characters.'
            : ru ? 'Ссылка недействительна — запроси новую.' : 'The link is invalid — request a new one.'}
        </Alert>
      )}
      <Input name="password" type="password" required minLength={8} placeholder={ru ? 'Новый пароль (мин. 8)' : 'New password (min 8)'} autoComplete="new-password" autoFocus />
      <Button type="submit" variant="primary" size="md" disabled={pending} className="w-full py-2.5">
        {ru ? 'Сменить пароль' : 'Change password'}
      </Button>
    </form>
  )
}
