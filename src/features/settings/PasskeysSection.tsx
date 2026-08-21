'use client'

import { useState } from 'react'
import { startRegistration } from '@simplewebauthn/browser'
import { Fingerprint, Loader2, Plus, Trash2 } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { beginPasskeyRegistration, deletePasskey, finishPasskeyRegistration, listPasskeys } from '@/features/auth/passkeys'
import { buttonClass } from '@/shared/ui/button-style'

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

  // Оптимистично убираем строку, но ОТКАЗ возвращаем на экран: правило последнего способа
  // входа отказывает молча только в коде, а человек должен понять, почему ключ остался.
  //
  // После отказа список берём У СЕРВЕРА, а не восстанавливаем снимок из замыкания. Два
  // удаления внахлёст берут замок строки в любом порядке: если позже нажатое прошло первым,
  // а раньше нажатое получило отказ, снимок вернул бы на экран УЖЕ УДАЛЁННЫЙ ключ — человек
  // видел бы то, чего нет (замечание авто-ревью по #815).
  async function remove(id: string) {
    setErr('')
    setList((prev) => prev.filter((p) => p.id !== id))
    const outcome = await deletePasskey(id)
    if (outcome === 'removed') return
    setList(await listPasskeys())
    setErr(t(outcome === 'last-method' ? 'auth.passkey.lastMethod' : 'auth.passkey.notFound', lang))
  }

  const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat(ru ? 'ru' : 'en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d)) : null)

  return (
    <div className="flex flex-col gap-3">
      {list.length === 0 ? (
        <p className="text-[0.8125rem] text-ink-2">
          {ru ? 'Passkey — вход по Touch/Face ID или аппаратному ключу, без пароля.' : 'A passkey lets you sign in with Touch/Face ID or a hardware key — no password.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
              <Fingerprint size={18} className="shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.8125rem] font-medium text-ink">{p.name}</div>
                <div className="font-mono text-[0.6875rem] text-muted">
                  {ru ? 'добавлен' : 'added'} {fmt(p.createdAt)}
                  {p.lastUsedAt ? ` · ${ru ? 'вход' : 'used'} ${fmt(p.lastUsedAt)}` : ''}
                </div>
              </div>
              <button type="button" onClick={() => remove(p.id)} aria-label={ru ? 'удалить' : 'remove'} className={buttonClass({ variant: 'danger', className: 'hover:bg-surface hover:text-danger' })}>
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
          className={buttonClass({ className: 'disabled:opacity-60' })}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {ru ? 'Добавить passkey' : 'Add a passkey'}
        </button>
        {err && <span className="text-[0.78125rem] text-danger">{err}</span>}
      </div>
    </div>
  )
}
