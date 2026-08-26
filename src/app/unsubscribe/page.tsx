import Link from 'next/link'
import { CheckCircle2, XCircle } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { unsubscribeAction } from './actions'
import { cardClass } from '@/shared/ui/card-style'

/** Страница по ссылке «Отписаться» из письма: подтверждение и результат. */
export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('unsubscribe.title', lang), robots: { index: false } }
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; done?: string; failed?: string }>
}) {
  const [{ token, done, failed }, lang] = await Promise.all([searchParams, getLang()])
  const state = done ? 'done' : failed || !token ? 'failed' : 'confirm'

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      {/* Заголовок страницы для диктора: видимого у этой страницы нет по замыслу,
          но без h1 человек не найдёт, где он оказался (WCAG 2.4.6, обход по заголовкам). */}
      <h1 className="sr-only">{t('unsubscribe.title', lang)}</h1>
      <div className={cardClass({ pad: 'lg', className: 'w-full max-w-note text-center' })}>
        {state === 'confirm' ? (
          <>
            <div className="text-title font-bold text-ink">{t('unsubscribe.confirm', lang)}</div>
            <p className="mt-1 text-body text-ink-2">{t('unsubscribe.confirmHint', lang)}</p>
            <form action={unsubscribeAction} className="mt-4">
              <input type="hidden" name="token" value={token} />
              <Button type="submit" className="w-full">
                {t('unsubscribe.action', lang)}
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="mb-2 flex justify-center">
              {state === 'done' ? <CheckCircle2 size={22} className="text-ok" /> : <XCircle size={22} className="text-danger" />}
            </div>
            <div className="text-title font-bold text-ink">{t(state === 'done' ? 'unsubscribe.done' : 'unsubscribe.failed', lang)}</div>
            <p className="mt-1 text-body text-ink-2">{t(state === 'done' ? 'unsubscribe.doneHint' : 'unsubscribe.failedHint', lang)}</p>
          </>
        )}
        <Link href="/settings" className="mt-4 inline-block text-body font-semibold text-accent hover:underline">
          {t('unsubscribe.toSettings', lang)}
        </Link>
      </div>
    </div>
  )
}
