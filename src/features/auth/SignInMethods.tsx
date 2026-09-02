'use client'

import { useActionState } from 'react'
import { Fingerprint, KeyRound, Link2, ShieldAlert, Unlink } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { buttonClass } from '@/shared/ui/button-style'
import { Alert } from '@/shared/ui/Alert'
import { ProviderMark } from '@/shared/ui/ProviderMark'
import { fill, t, type Lang, type TKey } from '@/shared/i18n'
import type { OauthProvider } from '@/shared/auth/oauth'
import { unlinkSignInMethod, type UnlinkState } from './link-actions'
import { cardClass } from '@/shared/ui/card-style'

export interface SignInMethodRow {
  provider: OauthProvider
  labelKey: string
  linked: boolean
  /** Провайдер выключен на этом стенде — показываем только если уже привязан. */
  available: boolean
}

/**
 * СПОСОБЫ ВХОДА в настройках: какие провайдеры ведут в этот аккаунт.
 *
 * Раньше вход новым провайдером заводил ОТДЕЛЬНОГО пользователя, и один человек
 * оказывался двумя авторами. Здесь он привязывает второй способ к тому аккаунту, в
 * котором уже сидит, — то же, что «Linked Accounts» у Gitea и GitLab.
 *
 * Отвязать последний способ нельзя: это дверь снаружи, и закрыть её изнутри — значит
 * потерять доступ навсегда. Правило проверяет сервер, здесь только объяснение.
 *
 * ⚠️ ПОКАЗЫВАЕМ ВСЕ ДВЕРИ, А НЕ ТОЛЬКО ПРОВАЙДЕРОВ. Пароль и passkey — тоже вход, и без
 * них список врал в опасную сторону: человек с одним GitHub видел «один способ привязан»
 * и не понимал, что других у него нет вовсе. Владелец назвал сценарий прямо
 * (02.09.2026): «может случиться так, что аккаунта в GitHub или Telegram может не стать.
 * Что тогда?» Поэтому единственная дверь названа предупреждением, как на странице
 * безопасности GitHub, где видно все методы и явно сказано, когда способ один.
 */
export function SignInMethods({
  rows,
  lang,
  notice,
  hasPassword,
  passkeys,
}: {
  rows: SignInMethodRow[]
  lang: Lang
  notice?: string
  hasPassword: boolean
  /** Сколько passkey заведено: каждый — отдельная дверь, но живут они в своей секции. */
  passkeys: number
}) {
  const [state, unlink, pending] = useActionState<UnlinkState, FormData>(unlinkSignInMethod, null)
  const shown = rows.filter((r) => r.available || r.linked)
  // Считаем ПРИГОДНЫЕ двери — те же, что считает сервер в signInMethodsCount: привязанный
  // провайдер, выключенный на этом стенде, показан, но войти им нельзя.
  const usable = shown.filter((r) => r.linked && r.available).length + (hasPassword ? 1 : 0) + passkeys

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {notice && <Alert variant={notice === 'linked' ? 'ok' : 'warn'}>{t(`auth.link.${notice}` as TKey, lang)}</Alert>}
      {state?.error && <Alert variant="warn">{t(state.error, lang)}</Alert>}
      {usable <= 1 && (
        <Alert variant="warn" icon={ShieldAlert}>
          <span className="min-w-0">{t('auth.onlyOneMethod', lang)}</span>
        </Alert>
      )}

      {/* Пароль и passkeys — такие же двери, поэтому стоят в одном списке с провайдерами.
          Действий у них тут нет: пароль меняется своей секцией, ключи — своей, и две
          кнопки «сменить» в разных местах спорили бы между собой. */}
      <div className={cardClass({ pad: 'sm', className: 'flex min-w-0 items-center gap-3' })}>
        <KeyRound size={18} className="shrink-0 text-ink-2" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-body text-ink">{t('auth.methodPassword', lang)}</div>
          <div className="truncate text-caption text-ink-2">
            {hasPassword ? t('auth.password.set', lang) : t('auth.methodNotLinked', lang)}
          </div>
        </div>
      </div>
      <div className={cardClass({ pad: 'sm', className: 'flex min-w-0 items-center gap-3' })}>
        <Fingerprint size={18} className="shrink-0 text-ink-2" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-body text-ink">{t('auth.methodPasskeys', lang)}</div>
          <div className="truncate text-caption text-ink-2">
            {passkeys > 0 ? fill('auth.methodPasskeysCount', lang, { n: String(passkeys) }) : t('auth.methodNotLinked', lang)}
          </div>
        </div>
      </div>

      {shown.map((r) => (
        <div key={r.provider} className={cardClass({ pad: 'sm', className: 'flex min-w-0 items-center gap-3' })}>
          <ProviderMark provider={r.provider} size={18} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-body text-ink">{t(r.labelKey as TKey, lang)}</div>
            <div className="truncate text-caption text-ink-2">
              {t(r.linked ? 'auth.methodLinked' : 'auth.methodNotLinked', lang)}
            </div>
          </div>
          {r.linked ? (
            <form action={unlink}>
              <input type="hidden" name="provider" value={r.provider} />
              <Button type="submit" variant="ghost" size="md" disabled={pending}>
                <Unlink size={14} />
                <span className="max-sm:sr-only">{t('auth.unlink', lang)}</span>
              </Button>
            </form>
          ) : (
            /* Ссылка, а не кнопка с fetch: привязка идёт тем же путём к провайдеру,
               что и вход, — меняется только намерение в куке. */
            <a href={`/api/auth/${r.provider}?intent=link`} className={buttonClass({ variant: 'outline', size: 'md' })}>
              <Link2 size={14} />
              <span className="max-sm:sr-only">{t('auth.link', lang)}</span>
            </a>
          )}
        </div>
      ))}
    </div>
  )
}
