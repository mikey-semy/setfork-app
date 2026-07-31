'use client'

import { useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { Field } from '@/shared/ui/Field'
import { useConfirm } from '@/shared/ui/use-confirm'
import { generateVapidKeys, setPushSubject } from './actions'
import { FormSaveBar } from '@/shared/ui/FormSaveBar'

export interface PushFormValues {
  publicKey: string
  subject: string
  configured: boolean
}

export function PushSettingsForm({ ru, v }: { ru: boolean; v: PushFormValues }) {
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const [pub, setPub] = useState(v.publicKey)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  async function gen() {
    if (busy) return
    if (
      pub &&
      !(await confirm({
        title: say('Regenerate keys?', 'Перегенерировать ключи?'),
        intro: say('Existing subscriptions will stop working.', 'Старые подписки перестанут работать.'),
        confirmLabel: say('Regenerate keys', 'Перегенерировать ключи'),
        cancelLabel: say('Cancel', 'Отмена'),
      }))
    )
      return
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

      <Field label={ru ? 'Публичный ключ' : 'Public key'}>
        <Input readOnly value={pub} placeholder={ru ? 'не задан' : 'not set'} className="font-mono text-[12px]" />
      </Field>

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
        <Field label={ru ? 'Subject (mailto: или URL сайта)' : 'Subject (mailto: or site URL)'}>
          <Input name="subject" defaultValue={v.subject} placeholder="mailto:admin@setfork.com" className="font-mono" />
        </Field>
        <FormSaveBar ru={ru} />
      </form>
      {confirmDialog}
    </div>
  )
}
