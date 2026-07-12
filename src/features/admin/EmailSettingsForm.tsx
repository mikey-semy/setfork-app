'use client'

import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { Switch } from '@/shared/ui/switch'
import { setEmailSettings, sendTestEmail } from './actions'

const field = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-hidden focus:border-border-strong'
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
            <input name="host" defaultValue={v.host} placeholder="smtp.example.com" className={`${field} font-mono`} />
          </div>
          <div>
            <label className={lbl}>Port</label>
            <input name="port" type="number" defaultValue={v.port || ''} placeholder="587" className={`${field} font-mono`} />
          </div>
          <div>
            <label className={lbl}>{ru ? 'Пользователь' : 'Username'}</label>
            <input name="user" defaultValue={v.user} autoComplete="off" placeholder={ru ? 'опц.' : 'optional'} className={`${field} font-mono`} />
          </div>
          <div>
            <label className={lbl}>{ru ? 'Пароль' : 'Password'}</label>
            <input name="pass" type="password" placeholder={v.passMask || secretPh} autoComplete="off" className={`${field} font-mono`} />
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>From</label>
            <input name="from" defaultValue={v.from} placeholder="SetFork <no-reply@setfork.com>" className={`${field} font-mono`} />
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>{ru ? 'Уведомления админу (фидбек, жалобы)' : 'Admin notifications (feedback, reports)'}</label>
            <input
              name="notifyTo"
              defaultValue={v.notifyTo}
              autoComplete="off"
              placeholder="admin@example.com, second@example.com"
              className={`${field} font-mono`}
            />
            <p className="mt-1 text-[12px] text-muted">
              {ru
                ? 'Через запятую. Пусто — на email админов из ADMIN_HANDLES.'
                : 'Comma-separated. Blank — sent to ADMIN_HANDLES admins’ emails.'}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[14px] font-medium text-ink">{ru ? 'TLS (implicit, порт 465)' : 'TLS (implicit, port 465)'}</div>
            <p className="text-[12px] text-muted">{ru ? 'Выкл для 587/STARTTLS и для MailHog.' : 'Off for 587/STARTTLS and for MailHog.'}</p>
          </div>
          <Switch name="secure" defaultChecked={v.secure} />
        </div>

        <div className="flex justify-end border-t border-border pt-4">
          <button className="rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">{ru ? 'Сохранить' : 'Save'}</button>
        </div>
      </form>

      {/* Тест-отправка использует СОХРАНЁННЫЕ настройки — сначала сохрани. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <input
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
          placeholder={ru ? 'адрес для теста (пусто — на ваш email)' : 'test recipient (blank = your email)'}
          className={`${field} max-w-[280px] flex-1`}
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
