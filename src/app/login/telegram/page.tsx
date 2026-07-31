import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { oauthEnabled } from '@/shared/auth/oauth'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { TelegramLoginWatcher } from '@/features/auth/TelegramLoginWatcher'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('signInTelegram', lang) }
}

/** Шаг Telegram-входа: t.me-ссылка на бота + поллинг подтверждения. */
export default async function TelegramLoginPage() {
  const [lang, session, c] = await Promise.all([getLang(), getSession(), cookies()])
  if (session) redirect('/')
  const token = c.get('tg_login')?.value
  if (!token || !oauthEnabled().telegram) redirect('/login')
  const botLink = `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=tl_${token}`

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-[23.75rem] rounded-xl border border-border bg-surface p-8 text-center shadow-card">
        <div className="font-logo mb-1 text-[2.375rem] leading-none text-ink">SF</div>
        <div className="mb-6 text-[0.875rem] text-ink-2">{t('tgLoginIntro', lang)}</div>

        <a
          href={botLink}
          target="_blank"
          rel="noreferrer"
          className="mb-4 flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-[0.875rem] font-semibold text-primary-fg"
        >
          {t('tgLoginOpen', lang)}
        </a>

        <TelegramLoginWatcher lang={lang} />

        <Link href="/login" className="mt-6 inline-block text-[0.78125rem] text-ink-2 hover:text-ink">
          ← {t('tgLoginAnother', lang)}
        </Link>
      </div>
    </div>
  )
}
