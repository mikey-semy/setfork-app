'use client'

import { useState } from 'react'
import { startRegistration } from '@simplewebauthn/browser'
import { Fingerprint, Plus, Trash2, Usb } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { beginPasskeyRegistration, deletePasskey, finishPasskeyRegistration, listPasskeys } from '@/features/auth/passkeys'
import { passkeyErrorKey, type PasskeyKind } from '@/shared/auth/passkey-error'
import { Alert } from '@/shared/ui/Alert'
import { buttonClass } from '@/shared/ui/button-style'
import { Spinner } from '@/shared/ui/Spinner'
import { Tooltip } from '@/shared/ui/Tooltip'

type Row = { id: string; name: string; createdAt: Date; lastUsedAt: Date | null }

/** Настройки → Passkeys: список + добавить (WebAuthn-регистрация) + удалить. */
export function PasskeysSection({ initial, lang }: { initial: Row[]; lang: Lang }) {
  const ru = lang === 'ru'
  const [list, setList] = useState<Row[]>(initial)
  const [busy, setBusy] = useState<PasskeyKind | null>(null)
  const [err, setErr] = useState('')

  async function add(kind: PasskeyKind) {
    setErr('')
    setBusy(kind)
    try {
      const options = await beginPasskeyRegistration(kind)
      const response = await startRegistration({ optionsJSON: options })
      const name = `Passkey · ${new Intl.DateTimeFormat(ru ? 'ru' : 'en', { day: 'numeric', month: 'short' }).format(new Date())}`
      const res = await finishPasskeyRegistration(response, name)
      if ('error' in res) {
        setErr(
          t(
            res.error === 'exists' ? 'auth.passkey.alreadyOnDevice' : res.error === 'expired' ? 'auth.passkey.expired' : 'auth.passkey.failed',
            lang,
          ),
        )
      } else {
        setList(await listPasskeys())
      }
    } catch (e) {
      // Отказ браузера НАЗЫВАЕМ: «уже есть на устройстве» — самый частый случай на
      // телефоне, и прежнее общее «не поддерживается» уводило человека в сторону.
      setErr(t(passkeyErrorKey(e), lang))
    } finally {
      setBusy(null)
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
        <p className="text-body text-ink-2">
          {ru ? 'Passkey — вход по Touch/Face ID или аппаратному ключу, без пароля.' : 'A passkey lets you sign in with Touch/Face ID or a hardware key — no password.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
              <Fingerprint size={18} className="shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-medium text-ink">{p.name}</div>
                <div className="font-mono text-caption text-muted">
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

      {/* Ряд кнопок: обе одной высоты (шкала CONTROL_H), подпись аппаратного ключа
          прячется на узком экране — остаётся значок с НАШЕЙ подсказкой. */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => add('device')} disabled={!!busy} className={buttonClass({ className: 'disabled:opacity-60' })}>
          {busy === 'device' ? <Spinner size="md" /> : <Plus size={14} />} {t('auth.passkey.addDevice', lang)}
        </button>
        <Tooltip label={t('auth.passkey.addKeyHint', lang)}>
          <button
            type="button"
            onClick={() => add('securityKey')}
            disabled={!!busy}
            aria-label={t('auth.passkey.addKey', lang)}
            className={buttonClass({ variant: 'ghost', className: 'disabled:opacity-60' })}
          >
            {busy === 'securityKey' ? <Spinner size="md" /> : <Usb size={14} />}
            <span className="hidden md:inline">{t('auth.passkey.addKey', lang)}</span>
          </button>
        </Tooltip>
      </div>
      {/* Отказ — отдельной полосой под кнопками: рядом с ними на 390px он сдавливал
          подписи в перенос, а перенесённая подпись не влезает в высоту кнопки. */}
      {err && <Alert variant="danger">{err}</Alert>}
    </div>
  )
}
