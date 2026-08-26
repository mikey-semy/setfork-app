import { KeyRound } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { ForgotPasswordForm } from '@/features/auth/PasswordResetForms'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('resetPasswordTitle', lang) }
}

export default async function ForgotPasswordPage() {
  const lang = await getLang()
  const ru = lang === 'ru'
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-[23.75rem]">
        <div className="mb-1 flex items-center gap-2 text-page font-bold text-ink">
          <KeyRound size={18} className="text-accent" /> {ru ? 'Сброс пароля' : 'Reset your password'}
        </div>
        <p className="mb-5 text-body text-ink-2">
          {ru
            ? 'Укажи почту аккаунта — пришлём ссылку для нового пароля.'
            : 'Enter your account email — we’ll send a link to set a new password.'}
        </p>
        <ForgotPasswordForm lang={lang} />
      </div>
    </div>
  )
}
