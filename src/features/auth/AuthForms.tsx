'use client'

import { useActionState } from 'react'
import { t, type Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { loginWithPassword, registerWithPassword, type AuthResult } from './actions'

// Геометрия auth-форм крупнее стандартной md (py-2.5 / py-3, text-14) — доводка поверх примитивов.
const field = 'px-3 py-2.5 text-[14px]'
const btn = 'w-full px-4 py-3 text-[14px] disabled:opacity-60'

export function LoginForm({ lang }: { lang: Lang }) {
  const [state, action, pending] = useActionState<AuthResult | null, FormData>(loginWithPassword, null)
  return (
    <form action={action} className="flex flex-col gap-3 text-left">
      <Input name="email" type="email" required autoComplete="email" placeholder={t('emailField', lang)} className={field} />
      <Input name="password" type="password" required autoComplete="current-password" placeholder={t('passwordField', lang)} className={field} />
      {state?.error && <div className="text-[12.5px] text-danger">{state.error}</div>}
      <Button type="submit" variant="primary" disabled={pending} className={btn}>
        {t('signIn', lang)}
      </Button>
      <a href="/forgot-password" className="text-center text-[12.5px] text-ink-2 hover:text-ink">
        {lang === 'ru' ? 'Забыл пароль?' : 'Forgot password?'}
      </a>
    </form>
  )
}

export function RegisterForm({ lang }: { lang: Lang }) {
  const [state, action, pending] = useActionState<AuthResult | null, FormData>(registerWithPassword, null)
  return (
    <form action={action} className="flex flex-col gap-3 text-left">
      <Input name="email" type="email" required autoComplete="email" placeholder={t('emailField', lang)} className={field} />
      <div>
        <Input name="handle" required autoComplete="username" placeholder={t('handleField', lang)} className={`${field} font-mono`} />
        <p className="mt-1 text-[11.5px] text-muted">{t('handleHint', lang)}</p>
      </div>
      <Input name="name" placeholder={t('displayName', lang)} className={field} />
      <Input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder={t('passwordField', lang)} className={field} />
      {state?.error && <div className="text-[12.5px] text-danger">{state.error}</div>}
      <Button type="submit" variant="primary" disabled={pending} className={btn}>
        {t('createAccount', lang)}
      </Button>
    </form>
  )
}
