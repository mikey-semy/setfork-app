'use client'

import { useActionState } from 'react'
import { t, type Lang } from '@/shared/i18n'
import { loginWithPassword, registerWithPassword, type AuthResult } from './actions'

const field = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[14px] text-ink outline-none focus:border-border-strong'
const btn = 'w-full rounded-md bg-primary px-4 py-3 text-[14px] font-semibold text-primary-fg disabled:opacity-60'

export function LoginForm({ lang }: { lang: Lang }) {
  const [state, action, pending] = useActionState<AuthResult | null, FormData>(loginWithPassword, null)
  return (
    <form action={action} className="flex flex-col gap-3 text-left">
      <input name="email" type="email" required autoComplete="email" placeholder={t('emailField', lang)} className={field} />
      <input name="password" type="password" required autoComplete="current-password" placeholder={t('passwordField', lang)} className={field} />
      {state?.error && <div className="text-[12.5px] text-[var(--danger)]">{state.error}</div>}
      <button disabled={pending} className={btn}>
        {t('signIn', lang)}
      </button>
    </form>
  )
}

export function RegisterForm({ lang }: { lang: Lang }) {
  const [state, action, pending] = useActionState<AuthResult | null, FormData>(registerWithPassword, null)
  return (
    <form action={action} className="flex flex-col gap-3 text-left">
      <input name="email" type="email" required autoComplete="email" placeholder={t('emailField', lang)} className={field} />
      <div>
        <input name="handle" required autoComplete="username" placeholder={t('handleField', lang)} className={`${field} font-mono`} />
        <p className="mt-1 text-[11.5px] text-muted">{t('handleHint', lang)}</p>
      </div>
      <input name="name" placeholder={t('displayName', lang)} className={field} />
      <input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder={t('passwordField', lang)} className={field} />
      {state?.error && <div className="text-[12.5px] text-[var(--danger)]">{state.error}</div>}
      <button disabled={pending} className={btn}>
        {t('createAccount', lang)}
      </button>
    </form>
  )
}
