import Link from 'next/link'
import { CheckCircle2, XCircle } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { confirmEmailChange } from '@/features/auth/email-flows'
import { cardClass } from '@/shared/ui/card-style'

/** Обработка ссылки из письма-подтверждения новой почты. */
export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('changeEmailTitle', lang) }
}

export default async function ChangeEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const [{ token }, lang] = await Promise.all([searchParams, getLang()])
  const ru = lang === 'ru'
  const outcome = token ? await confirmEmailChange(token) : 'invalid'

  const M = {
    ok: {
      icon: <CheckCircle2 size={22} className="text-ok" />,
      title: ru ? 'Почта изменена' : 'Email changed',
      sub: ru ? 'Новый адрес привязан и подтверждён.' : 'Your new address is attached and verified.',
    },
    invalid: {
      icon: <XCircle size={22} className="text-danger" />,
      title: ru ? 'Ссылка недействительна' : 'Link is invalid',
      sub: ru ? 'Ссылка истекла или повреждена — запроси смену почты в настройках заново.' : 'The link expired or is broken — request the email change again from settings.',
    },
    mismatch: {
      icon: <XCircle size={22} className="text-warn" />,
      title: ru ? 'Адрес аккаунта изменился' : 'Account email changed',
      sub: ru ? 'Текущий адрес уже другой — запроси смену заново.' : 'The current address is different now — request the change again.',
    },
    taken: {
      icon: <XCircle size={22} className="text-warn" />,
      title: ru ? 'Адрес занят' : 'Address is taken',
      sub: ru ? 'Этот адрес уже привязан к другому аккаунту.' : 'This address is already attached to another account.',
    },
  }[outcome]

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      {/* Заголовок страницы для диктора: видимого у этой страницы нет по замыслу,
          но без h1 человек не найдёт, где он оказался (WCAG 2.4.6, обход по заголовкам). */}
      <h1 className="sr-only">{t('changeEmailTitle', lang)}</h1>
      <div className={cardClass({ pad: 'lg', className: 'w-full max-w-note text-center' })}>
        <div className="mb-2 flex justify-center">{M.icon}</div>
        <div className="text-title font-bold text-ink">{M.title}</div>
        <p className="mt-1 text-body text-ink-2">{M.sub}</p>
        <Link href="/settings" className="mt-4 inline-block text-body font-semibold text-accent hover:underline">
          {ru ? '← в настройки' : '← back to settings'}
        </Link>
      </div>
    </div>
  )
}
