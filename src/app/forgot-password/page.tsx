import { KeyRound } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { ForgotPasswordForm } from '@/features/auth/PasswordResetForms'

export const metadata = { title: 'Reset password' }

export default async function ForgotPasswordPage() {
  const lang = await getLang()
  const ru = lang === 'ru'
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-[23.75rem]">
        <div className="mb-1 flex items-center gap-2 text-[1.125rem] font-bold text-ink">
          <KeyRound size={18} className="text-accent" /> {ru ? 'Сброс пароля' : 'Reset your password'}
        </div>
        <p className="mb-5 text-[0.8125rem] text-ink-2">
          {ru
            ? 'Укажи почту аккаунта — пришлём ссылку для нового пароля.'
            : 'Enter your account email — we’ll send a link to set a new password.'}
        </p>
        <ForgotPasswordForm lang={lang} />
      </div>
    </div>
  )
}
