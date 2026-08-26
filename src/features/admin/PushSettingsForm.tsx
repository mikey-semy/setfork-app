'use client'

import { t, type Lang } from '@/shared/i18n'
import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { Field } from '@/shared/ui/Field'
import { useConfirm } from '@/shared/ui/use-confirm'
import { generateVapidKeys, setPushSubject } from './actions'
import { FormSaveBar } from '@/shared/ui/FormSaveBar'
import { buttonClass } from '@/shared/ui/button-style'
import { Spinner } from '@/shared/ui/Spinner'

export interface PushFormValues {
  publicKey: string
  subject: string
  configured: boolean
}

export function PushSettingsForm({ lang, v }: { lang: Lang; v: PushFormValues }) {
  const ru = lang === 'ru'
  const [pub, setPub] = useState(v.publicKey)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  async function gen() {
    if (busy) return
    if (
      pub &&
      !(await confirm({
        title: t('admin.regenerateKeys', lang),
        intro: t('admin.existingSubscriptionsWillStop', lang),
        confirmLabel: t('admin.regenerateKeys2', lang),
        cancelLabel: t('admin.cancel2', lang),
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
      <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-body-sm text-ink-2">
        {ru
          ? 'Свои VAPID-ключи (без сторонних сервисов). Сгенерируйте пару — приватный хранится в БД, публичный отдаётся браузеру при подписке. Пусто = берётся из env (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY).'
          : 'Your own VAPID keys (no third-party service). Generate a pair — the private key stays in the DB, the public one is given to the browser on subscribe. Empty = taken from env.'}
      </div>

      <Field label={ru ? 'Публичный ключ' : 'Public key'}>
        <Input readOnly value={pub} placeholder={ru ? 'не задан' : 'not set'} className="font-mono text-body-sm" />
      </Field>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={gen}
          disabled={busy}
          className={buttonClass({ className: 'disabled:opacity-50' })}
        >
          {busy ? <Spinner size="md" /> : <KeyRound size={14} />}
          {pub ? (ru ? 'Перегенерировать ключи' : 'Regenerate keys') : ru ? 'Сгенерировать ключи' : 'Generate keys'}
        </button>
        {msg && <span className="text-body-sm text-ink-2">{msg}</span>}
      </div>

      <form action={setPushSubject} className="flex flex-col gap-2 border-t border-border pt-4">
        <Field label={ru ? 'Subject (mailto: или URL сайта)' : 'Subject (mailto: or site URL)'}>
          <Input name="subject" defaultValue={v.subject} placeholder="mailto:admin@setfork.com" className="font-mono" />
        </Field>
        <FormSaveBar lang={lang} />
      </form>
      {confirmDialog}
    </div>
  )
}
