import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { legalUrl } from '@/shared/docs'
import { RegisterForm } from '@/features/auth/AuthForms'

export const metadata = { title: 'Create account' }

export default async function RegisterPage() {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  if (session) redirect('/')

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-[23.75rem] rounded-xl border border-border bg-surface p-8 text-center shadow-card">
        <div className="font-logo mb-1 text-[2.375rem] leading-none text-ink">SF</div>
        <div className="mb-6 text-[0.875rem] font-semibold text-ink">{t('registerTitle', lang)}</div>

        <RegisterForm lang={lang} />

        <p className="mt-3 text-[0.6875rem] leading-relaxed text-muted">
          {t('agreeToTermsPrefix', lang)}{' '}
          <a href={legalUrl('terms', lang)} className="text-accent hover:underline">
            {t('termsOfService', lang)}
          </a>{' '}
          {t('agreeToTermsAnd', lang)}{' '}
          <a href={legalUrl('privacy', lang)} className="text-accent hover:underline">
            {t('privacyPolicy', lang)}
          </a>.
        </p>

        <div className="mt-4 text-[0.78125rem] text-ink-2">
          {t('haveAccount', lang)}{' '}
          <Link href="/login" className="font-semibold text-accent hover:underline">
            {t('signIn', lang)}
          </Link>
        </div>

        <Link href="/" className="mt-6 inline-block text-[0.78125rem] text-ink-2 hover:text-ink">
          ← SetFork
        </Link>
      </div>
    </div>
  )
}
