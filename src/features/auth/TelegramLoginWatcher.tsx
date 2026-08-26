'use client'

import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Spinner } from '@/shared/ui/Spinner'
import { t, type Lang } from '@/shared/i18n'

type PollResult = { url?: string; error?: string; pending?: boolean; needCode?: boolean; badCode?: boolean }

/**
 * Поллинг /api/auth/telegram/poll. Две фазы:
 *  1) ждём подтверждение в боте (pending),
 *  2) бот прислал код В Telegram → просим ввести его здесь (needCode). Ввод кода в
 *     ЭТОМ браузере (с токеном) завершает вход — relay чужой ссылки сессию не даёт (F2).
 */
export function TelegramLoginWatcher({ lang }: { lang: Lang }) {
  const [phase, setPhase] = useState<'waiting' | 'code' | 'expired'>('waiting')
  const [code, setCode] = useState('')
  const [badCode, setBadCode] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const stopped = useRef(false)

  useEffect(() => {
    stopped.current = false
    let timer: number
    const tick = async () => {
      if (stopped.current) return
      try {
        const res = await fetch('/api/auth/telegram/poll', { method: 'POST' })
        const j = (await res.json()) as PollResult
        if (j.url) {
          stopped.current = true
          window.location.assign(j.url)
          return
        }
        if (j.error) {
          stopped.current = true
          setPhase('expired')
          return
        }
        if (j.needCode) {
          stopped.current = true // подтверждено → дальше ведёт ввод кода, авто-поллинг не нужен
          setPhase('code')
          return
        }
      } catch {
        // сеть мигнула — следующий тик попробует снова
      }
      timer = window.setTimeout(tick, 2500)
    }
    timer = window.setTimeout(tick, 2500)
    return () => {
      stopped.current = true
      window.clearTimeout(timer)
    }
  }, [])

  async function submitCode(e: FormEvent) {
    e.preventDefault()
    if (submitting || code.length < 6) return
    setSubmitting(true)
    setBadCode(false)
    try {
      const res = await fetch('/api/auth/telegram/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const j = (await res.json()) as PollResult
      if (j.url) {
        window.location.assign(j.url)
        return
      }
      if (j.error) {
        setPhase('expired')
        return
      }
      if (j.badCode) {
        setBadCode(true)
        setCode('')
      }
    } catch {
      // сеть мигнула — пользователь повторит
    }
    setSubmitting(false)
  }

  if (phase === 'expired') {
    return <div className="text-[0.78125rem] text-danger">{t('tgLoginExpired', lang)}</div>
  }

  if (phase === 'code') {
    return (
      <form onSubmit={submitCode} className="flex flex-col gap-3 text-left">
        <label htmlFor="tg-code" className="text-[0.78125rem] text-ink-2">
          {t('tgLoginCodePrompt', lang)}
        </label>
        <Input
          id="tg-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          aria-label={t('tgLoginCodePrompt', lang)}
          size="lg"
          className="text-center text-[1.25rem] tracking-[0.4em]"
        />
        {badCode && <div className="text-[0.78125rem] text-danger">{t('tgLoginBadCode', lang)}</div>}
        <Button type="submit" variant="primary" size="lg" disabled={submitting || code.length < 6} className="w-full">
          {submitting ? <Spinner size="lg" /> : t('tgLoginCodeSubmit', lang)}
        </Button>
      </form>
    )
  }

  return (
    <div className="flex items-center justify-center gap-2 text-[0.78125rem] text-ink-2">
      <Spinner size="md" />
      {t('tgLoginWaiting', lang)}
    </div>
  )
}
