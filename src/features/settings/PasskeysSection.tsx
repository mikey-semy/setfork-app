'use client'

import { useState } from 'react'
import { startRegistration } from '@simplewebauthn/browser'
import { Fingerprint, Loader2, Plus, Trash2 } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { beginPasskeyRegistration, deletePasskey, finishPasskeyRegistration, listPasskeys } from '@/features/auth/passkeys'

type Row = { id: string; name: string; createdAt: Date; lastUsedAt: Date | null }

/** Настройки → Passkeys: список + добавить (WebAuthn-регистрация) + удалить. */
export function PasskeysSection({ initial, lang }: { initial: Row[]; lang: Lang }) {
  const ru = lang === 'ru'
  const [list, setList] = useState<Row[]>(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function add() {
    setErr('')
    setBusy(true)
    try {
      const options = await beginPasskeyRegistration()
      const response = await startRegistration({ optionsJSON: options })
      const name = `Passkey · ${new Intl.DateTimeFormat(ru ? 'ru' : 'en', { day: 'numeric', month: 'short' }).format(new Date())}`
      const res = await finishPasskeyRegistration(response, name)
      if ('error' in res) {
        setErr(
          res.error === 'exists'
            ? ru ? 'Этот ключ уже добавлен.' : 'This key is already registered.'
            : res.error === 'expired'
              ? ru ? 'Время вышло — попробуй ещё раз.' : 'Timed out — try again.'
              : ru ? 'Не удалось подтвердить ключ.' : 'Could not verify the key.',
        )
      } else {
        setList(await listPasskeys())
      }
    } catch {
      setErr(ru ? 'Отменено или не поддерживается браузером.' : 'Cancelled or not supported by the browser.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setList((prev) => prev.filter((p) => p.id !== id))
    await deletePasskey(id)
  }

  const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat(ru ? 'ru' : 'en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d)) : null)

  return (
    <div className="flex flex-col gap-3">
      {list.length === 0 ? (
        <p className="text-[13.5px] text-ink-2">
          {ru ? 'Passkey — вход по Touch/Face ID или аппаратному ключу, без пароля.' : 'A passkey lets you sign in with Touch/Face ID or a hardware key — no password.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
              <Fingerprint size={18} className="shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium text-ink">{p.name}</div>
                <div className="font-mono text-[11px] text-muted">
                  {ru ? 'добавлен' : 'added'} {fmt(p.createdAt)}
                  {p.lastUsedAt ? ` · ${ru ? 'вход' : 'used'} ${fmt(p.lastUsedAt)}` : ''}
                </div>
              </div>
              <button type="button" onClick={() => remove(p.id)} aria-label={ru ? 'удалить' : 'remove'} className="shrink-0 rounded-md p-1 text-muted hover:bg-surface hover:text-danger">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={add}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-[13px] font-semibold text-ink hover:border-border-strong disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {ru ? 'Добавить passkey' : 'Add a passkey'}
        </button>
        {err && <span className="text-[12.5px] text-danger">{err}</span>}
      </div>
    </div>
  )
}
