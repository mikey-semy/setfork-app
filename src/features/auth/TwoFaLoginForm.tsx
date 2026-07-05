'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import type { Lang } from '@/shared/i18n'
import { verify2faLogin } from './twofa'

export function TwoFaLoginForm({ lang }: { lang: Lang }) {
  const ru = lang === 'ru'
  const [state, action, pending] = useActionState(verify2faLogin, null)
  return (
    <form action={action} className="flex flex-col gap-3">
      {state?.error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">
          {ru ? 'Неверный код — попробуй ещё раз.' : 'Invalid code — try again.'}
        </div>
      )}
      <Input
        name="code"
        placeholder={ru ? 'Код (6 цифр или recovery)' : 'Code (6 digits or recovery)'}
        autoComplete="one-time-code"
        inputMode="numeric"
        autoFocus
        className="text-center font-mono text-[16px] tracking-widest"
      />
      <Button type="submit" variant="primary" size="md" disabled={pending} className="w-full py-2.5">
        {ru ? 'Войти' : 'Verify'}
      </Button>
      <Link href="/login" className="text-center text-[12.5px] text-ink-2 hover:text-ink">
        {ru ? '← назад ко входу' : '← back to sign in'}
      </Link>
    </form>
  )
}
