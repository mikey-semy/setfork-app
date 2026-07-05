import { KeyRound } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { ForgotPasswordForm } from '@/features/auth/PasswordResetForms'

export default async function ForgotPasswordPage() {
  const lang = await getLang()
  const ru = lang === 'ru'
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-[380px]">
        <div className="mb-1 flex items-center gap-2 text-[18px] font-bold text-ink">
          <KeyRound size={18} className="text-accent" /> {ru ? 'Сброс пароля' : 'Reset your password'}
        </div>
        <p className="mb-5 text-[13px] text-ink-2">
          {ru
            ? 'Укажи почту аккаунта — пришлём ссылку для нового пароля.'
            : 'Enter your account email — we’ll send a link to set a new password.'}
        </p>
        <ForgotPasswordForm lang={lang} />
      </div>
    </div>
  )
}
