'use client'

import { useActionState } from 'react'
import { Link2, Unlink } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { buttonClass } from '@/shared/ui/button-style'
import { Alert } from '@/shared/ui/Alert'
import { ProviderMark } from '@/shared/ui/ProviderMark'
import { t, type Lang, type TKey } from '@/shared/i18n'
import type { OauthProvider } from '@/shared/auth/oauth'
import { unlinkSignInMethod, type UnlinkState } from './link-actions'

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
 */
export function SignInMethods({ rows, lang, notice }: { rows: SignInMethodRow[]; lang: Lang; notice?: string }) {
  const [state, unlink, pending] = useActionState<UnlinkState, FormData>(unlinkSignInMethod, null)
  const shown = rows.filter((r) => r.available || r.linked)

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {notice && <Alert variant={notice === 'linked' ? 'ok' : 'warn'}>{t(`auth.link.${notice}` as TKey, lang)}</Alert>}
      {state?.error && <Alert variant="warn">{t(state.error, lang)}</Alert>}

      {shown.map((r) => (
        <div key={r.provider} className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface p-3">
          <ProviderMark provider={r.provider} size={18} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[0.8125rem] text-ink">{t(r.labelKey as TKey, lang)}</div>
            <div className="truncate text-[0.6875rem] text-ink-2">
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
