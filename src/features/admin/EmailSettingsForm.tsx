'use client'

import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { Switch } from '@/shared/ui/switch'
import { Input } from '@/shared/ui/input'
import { t } from '@/shared/i18n'
import { setEmailSettings, sendTestEmail } from './actions'
import { FormSaveBar } from '@/features/settings/FormSaveBar'

const lbl = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'

export interface EmailFormValues {
  host: string
  port: number
  secure: boolean
  user: string
  from: string
  passMask: string // маска пароля (реальное значение на клиент не уходит)
  notifyTo: string // адрес(а) для админ-уведомлений (фидбек/жалобы), через запятую
}

export function EmailSettingsForm({ ru, v }: { ru: boolean; v: EmailFormValues }) {
  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null)

  async function runTest() {
    setTesting(true)
    setResult(null)
    try {
      setResult(await sendTestEmail(testTo.trim()))
    } catch {
      setResult({ ok: false, error: ru ? 'Ошибка запроса.' : 'Request failed.' })
    } finally {
      setTesting(false)
    }
  }

  const secretPh = ru ? '•••• (задан) — пусто, чтобы не менять' : '•••• (set) — leave blank to keep'

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[12.5px] text-ink-2">
        {ru
          ? 'Свой SMTP-сервер (без сторонних сервисов). Пусто = берётся из .env. docker compose поднимает Stalwart (Rust MTA): host=mail, port=587; разовая настройка — админка Stalwart на :8080 (пароль в логах сервиса mail). Прод: домен + DKIM/SPF/DMARC.'
          : 'Your own SMTP server (no third-party service). Empty = taken from .env. docker compose runs Stalwart (Rust MTA): host=mail, port=587; one-time setup in Stalwart admin at :8080 (password in the mail service logs). Prod: domain + DKIM/SPF/DMARC.'}
      </div>

      <form action={setEmailSettings} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={lbl}>Host</label>
            <Input name="host" defaultValue={v.host} placeholder="smtp.example.com" className="font-mono" />
          </div>
          <div>
            <label className={lbl}>Port</label>
            <Input name="port" type="number" defaultValue={v.port || ''} placeholder="587" className="font-mono" />
          </div>
          <div>
            <label className={lbl}>{ru ? 'Пользователь' : 'Username'}</label>
            <Input name="user" defaultValue={v.user} autoComplete="off" placeholder={ru ? 'опц.' : 'optional'} className="font-mono" />
          </div>
          <div>
            <label className={lbl}>{ru ? 'Пароль' : 'Password'}</label>
            <Input name="pass" type="password" placeholder={v.passMask || secretPh} autoComplete="off" className="font-mono" />
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>From</label>
            <Input name="from" defaultValue={v.from} placeholder="SetFork <no-reply@setfork.com>" className="font-mono" />
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>{t('notifyToLabel', ru ? 'ru' : 'en')}</label>
            <Input
              name="notifyTo"
              defaultValue={v.notifyTo}
              autoComplete="off"
              placeholder="admin@example.com, second@example.com"
              className="font-mono"
            />
            <p className="mt-1 text-[12px] text-muted">{t('notifyToHint', ru ? 'ru' : 'en')}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[14px] font-medium text-ink">{ru ? 'TLS (implicit, порт 465)' : 'TLS (implicit, port 465)'}</div>
            <p className="text-[12px] text-muted">{ru ? 'Выкл для 587/STARTTLS и для MailHog.' : 'Off for 587/STARTTLS and for MailHog.'}</p>
          </div>
          <Switch name="secure" defaultChecked={v.secure} />
        </div>

        <FormSaveBar ru={ru} />
      </form>

      {/* Тест-отправка использует СОХРАНЁННЫЕ настройки — сначала сохрани. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Input
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
          placeholder={ru ? 'адрес для теста (пусто — на ваш email)' : 'test recipient (blank = your email)'}
          className="max-w-[280px] flex-1"
        />
        <button
          type="button"
          onClick={runTest}
          disabled={testing}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-[13px] font-medium text-ink hover:border-border-strong disabled:opacity-50"
        >
          {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {ru ? 'Тест-письмо' : 'Send test'}
        </button>
        {result && (
          <span className={`text-[12.5px] ${result.ok ? 'text-ok' : 'text-danger'}`}>
            {result.ok ? (ru ? 'Отправлено ✅' : 'Sent ✅') : result.error}
          </span>
        )}
      </div>
    </div>
  )
}
