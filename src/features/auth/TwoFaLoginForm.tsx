'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Alert } from '@/shared/ui/Alert'
import type { Lang } from '@/shared/i18n'
import { verify2faLogin } from './twofa'

export function TwoFaLoginForm({ lang }: { lang: Lang }) {
  const ru = lang === 'ru'
  const [state, action, pending] = useActionState(verify2faLogin, null)
  return (
    <form action={action} className="flex flex-col gap-3">
      {state?.error && (
        <Alert variant="danger">
          {ru ? 'Неверный код — попробуй ещё раз.' : 'Invalid code — try again.'}
        </Alert>
      )}
      <Input
        name="code"
        placeholder={ru ? 'Код (6 цифр или recovery)' : 'Code (6 digits or recovery)'}
        autoComplete="one-time-code"
        inputMode="numeric"
        autoFocus
        className="text-center font-mono text-[1rem] tracking-widest"
      />
      <Button type="submit" variant="primary" size="md" disabled={pending} className="h-10 w-full">
        {ru ? 'Войти' : 'Verify'}
      </Button>
      <Link href="/login" className="text-center text-[0.78125rem] text-ink-2 hover:text-ink">
        {ru ? '← назад ко входу' : '← back to sign in'}
      </Link>
    </form>
  )
}
