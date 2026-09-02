import { redirect } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { parseAuthorize } from '@/shared/auth/oauth-server'
import { grantAccess } from './actions'
import { Button } from '@/shared/ui/button'
import { cardClass } from '@/shared/ui/card-style'
import { PAGE } from '@/shared/ui/control'

/**
 * ЭКРАН СОГЛАСИЯ — ПОВЕРХ НАШЕЙ СОБСТВЕННОЙ СЕССИИ.
 *
 * Никакого отдельного входа для агента: человек уже вошёл на сайт, и это тот же
 * человек. Не вошёл — отправляем на наш `/login` с возвратом сюда, иначе начатое
 * подключение теряется и непонятно, куда делся запрос Claude.
 *
 * ⚠️ ЧТО ИМЕННО РАЗРЕШАЕМ — НАПИСАНО СЛОВАМИ. «Доступ к аккаунту» не сообщает ничего:
 * человек должен видеть, чтение это или запись, потому что запись означает правку его
 * списков чужими руками.
 */
export const dynamic = 'force-dynamic'

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [lang, session, sp] = await Promise.all([getLang(), getSession(), searchParams])
  const params = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : [])),
  )

  const parsed = parseAuthorize(params)
  // Ошибку показываем ЗДЕСЬ, а не редиректом с `error=`: пока запрос не проверен, адрес
  // возврата не заслужил доверия — на него нельзя ничего отправлять.
  if (!parsed.ok) {
    return (
      <main className={PAGE}>
        <div className={cardClass({ className: 'text-body text-ink' })}>
          <h1 className="mb-2 text-title font-semibold">{t('oauth.badRequest', lang)}</h1>
          <p className="text-body-sm text-ink-2">{parsed.error}</p>
        </div>
      </main>
    )
  }

  if (!session) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${params.toString()}`)}`)

  const scopeText = parsed.req.scope === 'write' ? t('oauth.scopeWrite', lang) : t('oauth.scopeRead', lang)

  return (
    <main className={PAGE}>
      <div className={cardClass({ className: 'flex flex-col gap-4' })}>
        <h1 className="text-title font-semibold text-ink">{t('oauth.title', lang)}</h1>
        <p className="text-body text-ink-2">{t('oauth.intro', lang).replace('{client}', parsed.req.clientId)}</p>
        <ul className="flex list-none flex-col gap-1 text-body text-ink">
          <li>{scopeText}</li>
          <li className="text-body-sm text-ink-2">{t('oauth.scopeNote', lang).replace('{who}', session.handle)}</li>
        </ul>
        {/* `touch="grow"`: на узком экране кнопки переносятся и встают в столбик, а
            зоны нажатия по 44px там накладываются — палец у границы делал бы соседнее
            действие. Здесь это «разрешить» вместо «отмена», то есть выдачу доступа. */}
        <form action={grantAccess} className="flex flex-wrap gap-2">
          {/* Запрос переносится в форму целиком, но серверу он не доверен: `grantAccess`
              разбирает и проверяет его заново. */}
          <input type="hidden" name="q" value={params.toString()} />
          <Button type="submit" variant="primary" touch="grow">
            {t('oauth.allow', lang)}
          </Button>
          <Button type="submit" name="deny" value="1" touch="grow">
            {t('oauth.deny', lang)}
          </Button>
        </form>
      </div>
    </main>
  )
}
