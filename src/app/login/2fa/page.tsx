import { redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { hasPendingLogin } from '@/features/auth/twofa'
import { TwoFaLoginForm } from '@/features/auth/TwoFaLoginForm'

/** Шаг 2FA после пароля: pending-кука (5 мин) уже стоит, сессии ещё нет. */
export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('twoFactorTitle', lang) }
}

export default async function TwoFaLoginPage() {
  const lang = await getLang()
  if (!(await hasPendingLogin())) redirect('/login')
  const ru = lang === 'ru'
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      {/* Заголовок страницы для диктора: видимого у этой страницы нет по замыслу,
          но без h1 человек не найдёт, где он оказался (WCAG 2.4.6, обход по заголовкам). */}
      <h1 className="sr-only">{t('twoFactorTitle', lang)}</h1>
      <div className="w-full max-w-form">
        <div className="mb-1 flex items-center gap-2 text-page font-bold text-ink">
          <ShieldCheck size={18} className="text-accent" /> {ru ? 'Подтверждение входа' : 'Two-factor authentication'}
        </div>
        <p className="mb-5 text-body text-ink-2">
          {ru
            ? 'Введите код из приложения-аутентификатора или один из recovery-кодов.'
            : 'Enter the code from your authenticator app, or one of your recovery codes.'}
        </p>
        <TwoFaLoginForm lang={lang} />
      </div>
    </div>
  )
}
