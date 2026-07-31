'use client'

import { useActionState } from 'react'
import { t, type Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { loginWithPassword, registerWithPassword, type AuthResult } from './actions'

// Геометрия auth-форм крупнее стандартной md — доводка поверх примитивов.
// ЯВНАЯ высота, а не py: у Button фиксированная высота из шкалы (control.ts),
// и вертикальный паддинг её не раздвинет (находка Codex по #610).
const btn = 'h-11 w-full px-4 text-[0.875rem] disabled:opacity-60'

export function LoginForm({ lang }: { lang: Lang }) {
  const [state, action, pending] = useActionState<AuthResult | null, FormData>(loginWithPassword, null)
  return (
    <form action={action} className="flex flex-col gap-3 text-left">
      <Input name="email" type="email" required autoComplete="email" placeholder={t('emailField', lang)} />
      <Input name="password" type="password" required autoComplete="current-password" placeholder={t('passwordField', lang)} />
      {state?.error && <div className="text-[0.78125rem] text-danger">{state.error}</div>}
      <Button type="submit" variant="primary" disabled={pending} className={btn}>
        {t('signIn', lang)}
      </Button>
      <a href="/forgot-password" className="text-center text-[0.78125rem] text-ink-2 hover:text-ink">
        {lang === 'ru' ? 'Забыл пароль?' : 'Forgot password?'}
      </a>
    </form>
  )
}

export function RegisterForm({ lang }: { lang: Lang }) {
  const [state, action, pending] = useActionState<AuthResult | null, FormData>(registerWithPassword, null)
  return (
    <form action={action} className="flex flex-col gap-3 text-left">
      <Input name="email" type="email" required autoComplete="email" placeholder={t('emailField', lang)} />
      <div>
        <Input name="handle" required autoComplete="username" placeholder={t('handleField', lang)} className="font-mono" />
        <p className="mt-1 text-[0.6875rem] text-muted">{t('handleHint', lang)}</p>
      </div>
      <Input name="name" placeholder={t('displayName', lang)} />
      <Input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder={t('passwordField', lang)} />
      {state?.error && <div className="text-[0.78125rem] text-danger">{state.error}</div>}
      <Button type="submit" variant="primary" disabled={pending} className={btn}>
        {t('createAccount', lang)}
      </Button>
    </form>
  )
}
