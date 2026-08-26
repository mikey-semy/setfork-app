import Link from 'next/link'
import { CheckCircle2, XCircle } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { consumeVerifyToken } from '@/features/auth/email-flows'
import { cardClass } from '@/shared/ui/card-style'

/** Обработка ссылки из письма-подтверждения. */
export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('verifyEmailTitle', lang) }
}

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const [{ token }, lang] = await Promise.all([searchParams, getLang()])
  const ru = lang === 'ru'
  const outcome = token ? await consumeVerifyToken(token) : 'invalid'

  const M = {
    ok: {
      icon: <CheckCircle2 size={22} className="text-ok" />,
      title: ru ? 'Почта подтверждена' : 'Email verified',
      sub: ru ? 'Спасибо! Адрес привязан к аккаунту.' : 'Thanks! Your address is confirmed.',
    },
    invalid: {
      icon: <XCircle size={22} className="text-danger" />,
      title: ru ? 'Ссылка недействительна' : 'Link is invalid',
      sub: ru ? 'Ссылка истекла или повреждена — запроси новое письмо в настройках.' : 'The link expired or is broken — request a new email from settings.',
    },
    mismatch: {
      icon: <XCircle size={22} className="text-warn" />,
      title: ru ? 'Почта изменилась' : 'Email has changed',
      sub: ru ? 'Адрес аккаунта уже другой — запроси новое письмо в настройках.' : 'The account email is different now — request a new email from settings.',
    },
  }[outcome]

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className={cardClass({ pad: 'lg', className: 'w-full max-w-[26.25rem] text-center' })}>
        <div className="mb-2 flex justify-center">{M.icon}</div>
        <div className="text-title font-bold text-ink">{M.title}</div>
        <p className="mt-1 text-body text-ink-2">{M.sub}</p>
        <Link href="/" className="mt-4 inline-block text-body font-semibold text-accent hover:underline">
          {ru ? '← на главную' : '← back home'}
        </Link>
      </div>
    </div>
  )
}
