import { redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { hasPendingLogin } from '@/features/auth/twofa'
import { TwoFaLoginForm } from '@/features/auth/TwoFaLoginForm'

/** Шаг 2FA после пароля: pending-кука (5 мин) уже стоит, сессии ещё нет. */
export const metadata = { title: 'Two-factor authentication' }

export default async function TwoFaLoginPage() {
  const lang = await getLang()
  if (!(await hasPendingLogin())) redirect('/login')
  const ru = lang === 'ru'
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-[23.75rem]">
        <div className="mb-1 flex items-center gap-2 text-[1.125rem] font-bold text-ink">
          <ShieldCheck size={18} className="text-accent" /> {ru ? 'Подтверждение входа' : 'Two-factor authentication'}
        </div>
        <p className="mb-5 text-[0.8125rem] text-ink-2">
          {ru
            ? 'Введи код из приложения-аутентификатора или один из recovery-кодов.'
            : 'Enter the code from your authenticator app, or one of your recovery codes.'}
        </p>
        <TwoFaLoginForm lang={lang} />
      </div>
    </div>
  )
}
