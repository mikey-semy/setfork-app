'use client'

import { useState, useTransition } from 'react'
import { Check, Copy, KeyRound, Loader2, Plus, Trash2, TriangleAlert } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import type { TokenRow } from './queries'
import { createApiToken, revokeApiToken } from './actions'

function Copyable({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {}
      }}
      className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[12px] text-ink-2 hover:text-ink"
    >
      {done ? <Check size={12} className="text-[var(--ok)]" /> : <Copy size={12} />} {label}
    </button>
  )
}

export function ApiTokensSection({ tokens, lang, mcpUrl }: { tokens: TokenRow[]; lang: Lang; mcpUrl: string }) {
  const ru = lang === 'ru'
  const [name, setName] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()

  function create() {
    const n = name.trim()
    if (!n || pending) return
    setErr('')
    start(async () => {
      const r = await createApiToken(n)
      if ('error' in r) setErr(ru ? 'Не удалось создать.' : 'Could not create.')
      else {
        setCreated(r.token)
        setName('')
      }
    })
  }

  const fmtDate = (d: Date | null) =>
    d ? new Intl.DateTimeFormat(ru ? 'ru' : 'en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(d)) : ru ? 'ни разу' : 'never'

  return (
    <div className="space-y-4">
      {/* Эндпоинт */}
      <div className="rounded-md border border-border bg-surface-2 p-3">
        <div className="mb-1 text-[12.5px] font-medium text-ink">{ru ? 'MCP-эндпоинт' : 'MCP endpoint'}</div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-surface px-2 py-1 font-mono text-[12px] text-accent">{mcpUrl}</code>
          <Copyable text={mcpUrl} label={ru ? 'Копировать' : 'Copy'} />
        </div>
        <p className="mt-1.5 text-[11.5px] text-ink-2">
          {ru
            ? 'Подключи в ИИ-клиенте как удалённый MCP-сервер, авторизация — Bearer-токеном ниже.'
            : 'Add it to your AI client as a remote MCP server; authenticate with a Bearer token below.'}
        </p>
      </div>

      {/* Показ только что созданного токена */}
      {created && (
        <div className="rounded-md border border-[var(--warn)] bg-surface p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--warn)]">
            <TriangleAlert size={14} /> {ru ? 'Скопируй сейчас — больше не покажем' : 'Copy it now — shown only once'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full overflow-x-auto rounded bg-surface-2 px-2 py-1 font-mono text-[12px] text-ink">{created}</code>
            <Copyable text={created} label={ru ? 'Копировать токен' : 'Copy token'} />
          </div>
        </div>
      )}

      {/* Создание */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              create()
            }
          }}
          placeholder={ru ? 'Название токена (напр. «Claude Desktop»)' : 'Token name (e.g. "Claude Desktop")'}
          className="min-w-[220px] flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-[13.5px] text-ink outline-none focus:border-border-strong"
        />
        <button
          type="button"
          onClick={create}
          disabled={pending || !name.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-fg disabled:opacity-50"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {ru ? 'Создать токен' : 'Create token'}
        </button>
      </div>
      {err && <p className="text-[12px] text-[var(--danger)]">{err}</p>}

      {/* Список */}
      {tokens.length === 0 ? (
        <p className="text-[13px] text-muted">{ru ? 'Токенов пока нет.' : 'No tokens yet.'}</p>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {tokens.map((tk) => (
            <div key={tk.id} className="flex items-center gap-3 px-3 py-2.5">
              <KeyRound size={15} className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium text-ink">{tk.name}</div>
                <div className="font-mono text-[11.5px] text-muted">
                  {tk.prefix} · {ru ? 'исп.' : 'used'} {fmtDate(tk.lastUsedAt)} · {ru ? 'создан' : 'created'} {fmtDate(tk.createdAt)}
                </div>
              </div>
              <form action={revokeApiToken.bind(null, tk.id)}>
                <button
                  className="inline-flex items-center gap-1 rounded p-1.5 text-muted hover:text-[var(--danger)]"
                  title={ru ? 'Отозвать' : 'Revoke'}
                >
                  <Trash2 size={15} />
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
