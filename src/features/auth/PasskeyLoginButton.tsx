'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { startAuthentication } from '@simplewebauthn/browser'
import { Fingerprint, Loader2 } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { beginPasskeyLogin, finishPasskeyLogin } from '@/features/auth/passkeys'

/** Кнопка «Войти по passkey» на /login (WebAuthn-аутентификация, discoverable). */
export function PasskeyLoginButton({ lang }: { lang: Lang }) {
  const ru = lang === 'ru'
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function go() {
    setErr('')
    setBusy(true)
    try {
      const options = await beginPasskeyLogin()
      const response = await startAuthentication({ optionsJSON: options })
      const res = await finishPasskeyLogin(response)
      if ('error' in res) {
        setErr(
          res.error === 'throttled'
            ? ru ? 'Слишком много попыток — подожди.' : 'Too many attempts — wait a bit.'
            : res.error === 'unknown'
              ? ru ? 'Passkey не найден.' : 'Passkey not recognised.'
              : ru ? 'Не удалось войти.' : 'Sign-in failed.',
        )
        setBusy(false)
        return
      }
      router.push('/')
      router.refresh()
    } catch {
      setErr(ru ? 'Отменено или не поддерживается.' : 'Cancelled or not supported.')
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-[13px] font-semibold text-ink hover:border-border-strong disabled:opacity-60"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Fingerprint size={15} />} {ru ? 'Войти по passkey' : 'Sign in with a passkey'}
      </button>
      {err && <span className="text-center text-[12.5px] text-danger">{err}</span>}
    </div>
  )
}
