'use client'

import { useActionState } from 'react'
import { KeyRound } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { MIN_PASSWORD_LENGTH } from '@/shared/auth/password-policy'
import { Alert } from '@/shared/ui/Alert'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useKeepFormValues } from '@/shared/ui/keep-form-values'
import { setPassword, type PasswordState } from './password-actions'

/**
 * ПАРОЛЬ В НАСТРОЙКАХ: задать, если его нет, сменить, если есть.
 *
 * Форма одна на оба случая — они отличаются только полем текущего пароля, и разводить
 * два экрана значило бы объяснять человеку разницу, которой для него нет.
 */
export function PasswordSection({ hasPassword, lang }: { hasPassword: boolean; lang: Lang }) {
  const [state, action, pending] = useActionState<PasswordState, FormData>(setPassword, null)
  // Отказ не должен стирать набранное — кроме самих паролей: их сохранять нельзя.
  const { formRef, onSubmit } = useKeepFormValues(!!state?.error, pending, { skip: ['current', 'password'] })

  return (
    <form ref={formRef} onSubmit={onSubmit} action={action} className="flex flex-col gap-3">
      {!hasPassword && (
        <Alert variant="warn">
          <span className="min-w-0">{t('auth.password.none', lang)}</span>
        </Alert>
      )}
      {state?.error && <Alert variant="danger">{t(state.error, lang)}</Alert>}
      {state?.ok && <Alert variant="ok">{t('auth.password.done', lang)}</Alert>}

      {hasPassword && (
        <Input
          size="lg"
          name="current"
          type="password"
          required
          autoComplete="current-password"
          placeholder={t('auth.password.current', lang)}
        />
      )}
      <Input
        size="lg"
        name="password"
        type="password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete="new-password"
        placeholder={t('auth.password.new', lang)}
      />
      {/* Кнопка в свою ширину, а не во всю строку: на телефоне форма и так во всю ширину,
          а растянутая кнопка выглядит как единственное действие экрана. */}
      <Button type="submit" variant="primary" size="lg" disabled={pending} className="self-start">
        <KeyRound size={15} />
        {t(hasPassword ? 'auth.password.submitChange' : 'auth.password.submitSet', lang)}
      </Button>
    </form>
  )
}
