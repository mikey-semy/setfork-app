'use client'

import { useActionState } from 'react'
import { t, type Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { loginWithPassword, registerWithPassword, type AuthResult } from './actions'

// Вход и регистрация — форма во всю ширину: и поля, и кнопка идут ступенью lg
// шкалы (control.ts). Раньше кнопка объявляла высоту руками (`h-11 px-4`), а поля
// оставались md — то есть в одной колонке стояли контролы 44 и 32px.
const btn = 'w-full disabled:opacity-60'

export function LoginForm({ lang, next }: { lang: Lang; next?: string }) {
  const [state, action, pending] = useActionState<AuthResult | null, FormData>(loginWithPassword, null)
  return (
    <form action={action} className="flex flex-col gap-3 text-left">
      {/* Куда вернуть после входа. Нужен потоку подключения MCP: он начинается на
          экране согласия, и без возврата человек оказывался на главной с потерянным
          запросом. Значение проверяется на сервере — в адрес пускаются только
          внутренние пути. */}
      {next && <input type="hidden" name="next" value={next} />}
      <Input size="lg" name="email" type="email" required autoComplete="email" placeholder={t('emailField', lang)} />
      <Input size="lg" name="password" type="password" required autoComplete="current-password" placeholder={t('passwordField', lang)} />
      {state?.error && <div className="text-body-sm text-danger">{state.error}</div>}
      <Button type="submit" variant="primary" size="lg" disabled={pending} className={btn}>
        {t('signIn', lang)}
      </Button>
      <a href="/forgot-password" className="text-center text-body-sm text-ink-2 hover:text-ink">
        {lang === 'ru' ? 'Забыл пароль?' : 'Forgot password?'}
      </a>
    </form>
  )
}

export function RegisterForm({ lang }: { lang: Lang }) {
  const [state, action, pending] = useActionState<AuthResult | null, FormData>(registerWithPassword, null)
  return (
    <form action={action} className="flex flex-col gap-3 text-left">
      <Input size="lg" name="email" type="email" required autoComplete="email" placeholder={t('emailField', lang)} />
      <div>
        <Input size="lg" name="handle" required autoComplete="username" placeholder={t('handleField', lang)} className="font-mono" />
        <p className="mt-1 text-caption text-muted">{t('handleHint', lang)}</p>
      </div>
      <Input size="lg" name="name" placeholder={t('displayName', lang)} />
      <Input size="lg" name="password" type="password" required minLength={8} autoComplete="new-password" placeholder={t('passwordField', lang)} />
      {state?.error && <div className="text-body-sm text-danger">{state.error}</div>}
      <Button type="submit" variant="primary" size="lg" disabled={pending} className={btn}>
        {t('createAccount', lang)}
      </Button>
    </form>
  )
}
