import { KeyRound } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { ForgotPasswordForm } from '@/features/auth/PasswordResetForms'
import { mailConfigured } from '@/shared/settings/email'
import { Alert } from '@/shared/ui/Alert'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('resetPasswordTitle', lang) }
}

export default async function ForgotPasswordPage() {
  const [lang, canMail] = await Promise.all([getLang(), mailConfigured()])
  const ru = lang === 'ru'
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      {/* Заголовок страницы для диктора: видимого у этой страницы нет по замыслу,
          но без h1 человек не найдёт, где он оказался (WCAG 2.4.6, обход по заголовкам). */}
      <h1 className="sr-only">{t('resetPasswordTitle', lang)}</h1>
      <div className="w-full max-w-form">
        <div className="mb-1 flex items-center gap-2 text-page font-bold text-ink">
          <KeyRound size={18} className="text-accent" /> {ru ? 'Сброс пароля' : 'Reset your password'}
        </div>
        <p className="mb-5 text-body text-ink-2">
          {ru
            ? 'Укажите почту аккаунта — пришлём ссылку для нового пароля.'
            : 'Enter your account email — we’ll send a link to set a new password.'}
        </p>
        {/* Формы нет, когда письму неоткуда взяться: пустая форма с ответом «проверьте
            почту» — это обещание, которое стенд не может выполнить. */}
        {canMail ? <ForgotPasswordForm lang={lang} /> : <Alert variant="warn">{t('auth.mailNotConfigured', lang)}</Alert>}
      </div>
    </div>
  )
}
