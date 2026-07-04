'use client'

import { useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { generateVapidKeys, setPushSubject } from './actions'

const field = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-none focus:border-border-strong'
const lbl = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'

export interface PushFormValues {
  publicKey: string
  subject: string
  configured: boolean
}

export function PushSettingsForm({ ru, v }: { ru: boolean; v: PushFormValues }) {
  const [pub, setPub] = useState(v.publicKey)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function gen() {
    if (busy) return
    if (pub && !confirm(ru ? 'Перегенерировать ключи? Старые подписки перестанут работать.' : 'Regenerate keys? Existing subscriptions will stop working.')) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await generateVapidKeys()
      if ('ok' in r) {
        setPub(r.publicKey)
        setMsg(ru ? 'Ключи сгенерированы ✅' : 'Keys generated ✅')
      } else setMsg(r.error)
    } catch {
      setMsg(ru ? 'Ошибка.' : 'Failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[12.5px] text-ink-2">
        {ru
          ? 'Свои VAPID-ключи (без сторонних сервисов). Сгенерируйте пару — приватный хранится в БД, публичный отдаётся браузеру при подписке. Пусто = берётся из env (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY).'
          : 'Your own VAPID keys (no third-party service). Generate a pair — the private key stays in the DB, the public one is given to the browser on subscribe. Empty = taken from env.'}
      </div>

      <div>
        <label className={lbl}>{ru ? 'Публичный ключ' : 'Public key'}</label>
        <input readOnly value={pub} placeholder={ru ? 'не задан' : 'not set'} className={`${field} font-mono text-[12px]`} />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={gen}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-[13px] font-medium text-ink hover:border-border-strong disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
          {pub ? (ru ? 'Перегенерировать ключи' : 'Regenerate keys') : ru ? 'Сгенерировать ключи' : 'Generate keys'}
        </button>
        {msg && <span className="text-[12.5px] text-ink-2">{msg}</span>}
      </div>

      <form action={setPushSubject} className="flex flex-col gap-2 border-t border-border pt-4">
        <div>
          <label className={lbl}>{ru ? 'Subject (mailto: или URL сайта)' : 'Subject (mailto: or site URL)'}</label>
          <input name="subject" defaultValue={v.subject} placeholder="mailto:admin@setfork.com" className={`${field} font-mono`} />
        </div>
        <div className="flex justify-end">
          <button className="rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">{ru ? 'Сохранить' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}
