import Link from 'next/link'
import { CheckCircle2, XCircle } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { unsubscribeAction } from './actions'

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
      <div className="w-full max-w-[26.25rem] rounded-lg border border-border bg-surface p-6 text-center">
        {state === 'confirm' ? (
          <>
            <div className="text-[1rem] font-bold text-ink">{t('unsubscribe.confirm', lang)}</div>
            <p className="mt-1 text-[0.8125rem] text-ink-2">{t('unsubscribe.confirmHint', lang)}</p>
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
            <div className="text-[1rem] font-bold text-ink">{t(state === 'done' ? 'unsubscribe.done' : 'unsubscribe.failed', lang)}</div>
            <p className="mt-1 text-[0.8125rem] text-ink-2">{t(state === 'done' ? 'unsubscribe.doneHint' : 'unsubscribe.failedHint', lang)}</p>
          </>
        )}
        <Link href="/settings" className="mt-4 inline-block text-[0.8125rem] font-semibold text-accent hover:underline">
          {t('unsubscribe.toSettings', lang)}
        </Link>
      </div>
    </div>
  )
}
