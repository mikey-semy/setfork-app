import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { RegisterForm } from '@/features/auth/AuthForms'

export default async function RegisterPage() {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  if (session) redirect('/')

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-[380px] rounded-xl border border-border bg-surface p-8 text-center shadow-card">
        <div className="mb-1 text-[40px] font-bold leading-none tracking-tight text-ink">SH</div>
        <div className="mb-6 text-[14px] font-semibold text-ink">{t('registerTitle', lang)}</div>

        <RegisterForm lang={lang} />

        <div className="mt-4 text-[12.5px] text-ink-2">
          {t('haveAccount', lang)}{' '}
          <Link href="/login" className="font-semibold text-accent hover:underline">
            {t('signIn', lang)}
          </Link>
        </div>

        <Link href="/" className="mt-6 inline-block text-[12.5px] text-ink-2 hover:text-ink">
          ← SetFork
        </Link>
      </div>
    </div>
  )
}
