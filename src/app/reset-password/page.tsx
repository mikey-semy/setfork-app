import Link from 'next/link'
import { KeyRound, XCircle } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { checkResetToken } from '@/features/auth/email-flows'
import { ResetPasswordForm } from '@/features/auth/PasswordResetForms'
import { cardClass } from '@/shared/ui/card-style'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('newPasswordTitle', lang) }
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const [{ token }, lang] = await Promise.all([searchParams, getLang()])
  const ru = lang === 'ru'
  const valid = token ? await checkResetToken(token) : false

  if (!valid) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className={cardClass({ pad: 'lg', className: 'w-full max-w-note text-center' })}>
          <div className="mb-2 flex justify-center">
            <XCircle size={22} className="text-danger" />
          </div>
          <div className="text-title font-bold text-ink">{ru ? 'Ссылка недействительна' : 'Link is invalid'}</div>
          <p className="mt-1 text-body text-ink-2">
            {ru ? 'Ссылка истекла или уже использована.' : 'The link has expired or was already used.'}
          </p>
          <Link href="/forgot-password" className="mt-4 inline-block text-body font-semibold text-accent hover:underline">
            {ru ? 'Запросить новую' : 'Request a new one'}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      {/* Заголовок страницы для диктора: видимого у этой страницы нет по замыслу,
          но без h1 человек не найдёт, где он оказался (WCAG 2.4.6, обход по заголовкам). */}
      <h1 className="sr-only">{t('newPasswordTitle', lang)}</h1>
      <div className="w-full max-w-form">
        <div className="mb-1 flex items-center gap-2 text-page font-bold text-ink">
          <KeyRound size={18} className="text-accent" /> {ru ? 'Новый пароль' : 'Set a new password'}
        </div>
        <p className="mb-5 text-body text-ink-2">
          {ru ? 'После смены пароля вы выйдете со всех устройств.' : 'After the change you’ll be signed out on all devices.'}
        </p>
        <ResetPasswordForm token={token!} lang={lang} />
      </div>
    </div>
  )
}
