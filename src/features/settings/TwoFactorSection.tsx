'use client'

import { useState, useTransition } from 'react'
import { Copy, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Alert } from '@/shared/ui/Alert'
import type { Lang } from '@/shared/i18n'
import { beginTotpEnroll, confirmTotpEnroll, disableTotp, regenerateRecoveryCodes, type EnrollStart } from '@/features/auth/twofa'
import { cardClass } from '@/shared/ui/card-style'
import { SmartImage } from '@/shared/ui/SmartImage'

// Настройки → Двухфакторная аутентификация (TOTP).
// Флоу включения: QR/секрет → код из приложения → recovery-коды (один раз).
// Отключение и перегенерация recovery требуют действующий код (или recovery).

export function TwoFactorSection({ enabled, lang }: { enabled: boolean; lang: Lang }) {
  const ru = lang === 'ru'
  const [isOn, setIsOn] = useState(enabled)
  const [enroll, setEnroll] = useState<EnrollStart | null>(null)
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState<string[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [mode, setMode] = useState<'idle' | 'disable' | 'regen'>('idle')
  const [pending, start] = useTransition()

  const badCode = ru ? 'Неверный код' : 'Invalid code'
  const expired = ru ? 'Сессия включения истекла — начни заново' : 'Enrollment expired — start again'

  const begin = () =>
    start(async () => {
      setErr(null)
      setEnroll(await beginTotpEnroll())
    })

  const confirm = () =>
    start(async () => {
      setErr(null)
      const r = await confirmTotpEnroll(code)
      if (!r.ok) {
        setErr(r.error === 'expired' ? expired : badCode)
        return
      }
      setIsOn(true)
      setEnroll(null)
      setCode('')
      setRecovery(r.recovery ?? null)
    })

  const doDisable = () =>
    start(async () => {
      setErr(null)
      const r = await disableTotp(code)
      if (!r.ok) {
        setErr(badCode)
        return
      }
      setIsOn(false)
      setMode('idle')
      setCode('')
      setRecovery(null)
    })

  const doRegen = () =>
    start(async () => {
      setErr(null)
      const r = await regenerateRecoveryCodes(code)
      if (!r.ok) {
        setErr(badCode)
        return
      }
      setMode('idle')
      setCode('')
      setRecovery(r.recovery ?? null)
    })

  const codeInput = (onSubmit: () => void, placeholder: string) => (
    <div className="flex items-center gap-2">
      <Input
        size="sm"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        placeholder={placeholder}
        autoComplete="one-time-code"
        inputMode="numeric"
        className="w-field-lg font-mono tracking-widest"
      />
      <Button variant="primary" size="sm" disabled={pending || !code.trim()} onClick={onSubmit}>
        {ru ? 'Подтвердить' : 'Confirm'}
      </Button>
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {isOn ? (
          <>
            <ShieldCheck size={16} className="text-ok" />
            <span className="text-body font-semibold text-ink">{ru ? 'Двухфакторная защита включена' : 'Two-factor is enabled'}</span>
            <Badge variant="ok">TOTP</Badge>
          </>
        ) : (
          <>
            <ShieldOff size={16} className="text-muted" />
            <span className="text-body text-ink-2">
              {ru ? 'Не включена — аккаунт защищён только паролем.' : 'Not enabled — your account is protected by password only.'}
            </span>
          </>
        )}
      </div>

      {err && <Alert variant="danger">{err}</Alert>}

      {/* Одноразовый показ recovery-кодов */}
      {recovery && (
        <div className={cardClass({ tone: 'warn' })}>
          <div className="mb-1.5 text-body font-semibold text-ink">
            {ru ? 'Recovery-коды — сохрани сейчас, второй раз не покажем' : 'Recovery codes — save them now, they won’t be shown again'}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-body text-ink sm:grid-cols-5">
            {recovery.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <Button
            size="xs"
            variant="ghost"
            className="mt-2 text-accent"
            onClick={() => void navigator.clipboard.writeText(recovery.join('\n'))}
          >
            <Copy size={12} /> {ru ? 'Скопировать все' : 'Copy all'}
          </Button>
        </div>
      )}

      {!isOn && !enroll && (
        <div>
          <Button variant="primary" disabled={pending} onClick={begin}>
            <ShieldCheck size={14} /> {ru ? 'Включить 2FA' : 'Enable 2FA'}
          </Button>
        </div>
      )}

      {!isOn && enroll && (
        <div className={cardClass({ tone: 'inset', className: 'flex flex-col gap-3 sm:flex-row sm:items-start' })}>
          {/* eslint-disable-next-line @next/next/no-img-element, no-restricted-syntax -- локальный data:URL QR; рамка КАРТИНКИ: белый фон обязателен для читаемости сканером */}
          <SmartImage src={enroll.qrDataUrl} alt="TOTP QR" width={160} height={160} className="shrink-0 rounded-md border border-border bg-white p-1" />
          <div className="min-w-0 flex-1">
            <p className="text-body text-ink-2">
              {ru
                ? 'Отсканируй QR в приложении-аутентификаторе (1Password, Google Authenticator, Aegis…) или введи секрет вручную:'
                : 'Scan the QR with your authenticator app (1Password, Google Authenticator, Aegis…) or enter the secret manually:'}
            </p>
            <code className="mt-1.5 block break-all rounded-md bg-surface px-2 py-1 font-mono text-body-sm text-ink">{enroll.secret}</code>
            <div className="mt-3">{codeInput(confirm, ru ? 'Код из приложения' : 'Code from the app')}</div>
          </div>
        </div>
      )}

      {isOn && mode === 'idle' && (
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => { setMode('regen'); setCode(''); setErr(null) }}>
            <KeyRound size={13} /> {ru ? 'Новые recovery-коды' : 'Regenerate recovery codes'}
          </Button>
          <Button variant="danger" onClick={() => { setMode('disable'); setCode(''); setErr(null) }}>
            <ShieldOff size={13} /> {ru ? 'Отключить 2FA' : 'Disable 2FA'}
          </Button>
        </div>
      )}

      {isOn && mode !== 'idle' && (
        <div className={cardClass({ tone: 'inset' })}>
          <p className="mb-2 text-body text-ink-2">
            {mode === 'disable'
              ? ru ? 'Для отключения введи код из приложения (или recovery-код):' : 'Enter a code from your app (or a recovery code) to disable:'
              : ru ? 'Для перегенерации введи код из приложения (или recovery-код). Старые коды перестанут работать.' : 'Enter a code to regenerate. Old recovery codes will stop working.'}
          </p>
          <div className="flex items-center gap-2">
            {codeInput(mode === 'disable' ? doDisable : doRegen, ru ? 'Код' : 'Code')}
            <Button variant="ghost" size="sm" onClick={() => { setMode('idle'); setErr(null) }}>
              {ru ? 'Отмена' : 'Cancel'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
