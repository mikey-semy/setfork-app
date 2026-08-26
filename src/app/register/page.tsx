import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { legalUrl } from '@/shared/docs'
import { RegisterForm } from '@/features/auth/AuthForms'
import { cardClass } from '@/shared/ui/card-style'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('createAccount', lang) }
}

export default async function RegisterPage() {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  if (session) redirect('/')

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className={cardClass({ pad: 'lg', className: 'w-full max-w-[23.75rem] text-center shadow-card' })}>
        <div className="font-logo mb-1 text-logo leading-none text-ink">SF</div>
        <div className="mb-6 text-body-lg font-semibold text-ink">{t('registerTitle', lang)}</div>

        <RegisterForm lang={lang} />

        <p className="mt-3 text-caption leading-relaxed text-muted">
          {t('agreeToTermsPrefix', lang)}{' '}
          <a href={legalUrl('terms', lang)} className="text-accent hover:underline">
            {t('termsOfService', lang)}
          </a>{' '}
          {t('agreeToTermsAnd', lang)}{' '}
          <a href={legalUrl('privacy', lang)} className="text-accent hover:underline">
            {t('privacyPolicy', lang)}
          </a>.
        </p>

        <div className="mt-4 text-body-sm text-ink-2">
          {t('haveAccount', lang)}{' '}
          <Link href="/login" className="font-semibold text-accent hover:underline">
            {t('signIn', lang)}
          </Link>
        </div>

        <Link href="/" className="mt-6 inline-block text-body-sm text-ink-2 hover:text-ink">
          ← SetFork
        </Link>
      </div>
    </div>
  )
}
