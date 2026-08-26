'use client'

import { useState, useTransition } from 'react'
import { Check, Copy, KeyRound, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Tooltip } from '@/shared/ui/Tooltip'
import type { Lang } from '@/shared/i18n'
import type { TokenRow } from './queries'
import { createApiToken, revokeApiToken } from './actions'
import { cardClass } from '@/shared/ui/card-style'
import { buttonClass } from '@/shared/ui/button-style'
import { Spinner } from '@/shared/ui/Spinner'
import { Badge } from '@/shared/ui/badge'
import { IconButton } from '@/shared/ui/IconButton'
import { Input } from '@/shared/ui/input'

// Чистая — на модульном уровне, а не в теле компонента (react-doctor:
// пересборка на каждый рендер ломает мемоизацию детей).
const pill = (active: boolean) =>
  `rounded-md px-2.5 py-1 text-body-sm font-medium ${active ? 'bg-primary text-primary-fg' : 'border border-border text-ink-2 hover:text-ink'}`

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
      className={buttonClass()}
    >
      {done ? <Check size={12} className="text-ok" /> : <Copy size={12} />} {label}
    </button>
  )
}

export function ApiTokensSection({ tokens, lang, mcpUrl }: { tokens: TokenRow[]; lang: Lang; mcpUrl: string }) {
  const ru = lang === 'ru'
  // Одна подпись на подсказку и на имя для диктора: расписанная дважды, она разъедется.
  const revokeLabel = ru ? 'Отозвать' : 'Revoke'
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'read' | 'write'>('write')
  const [expiryDays, setExpiryDays] = useState<number>(90)
  const [created, setCreated] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()

  function create() {
    const n = name.trim()
    if (!n || pending) return
    setErr('')
    start(async () => {
      const r = await createApiToken(n, scope, expiryDays)
      if ('error' in r) setErr(ru ? 'Не удалось создать.' : 'Could not create.')
      else {
        setCreated(r.token)
        setName('')
      }
    })
  }

  const EXPIRY = [
    { d: 30, en: '30 days', ru: '30 дней' },
    { d: 90, en: '90 days', ru: '90 дней' },
    { d: 365, en: '1 year', ru: '1 год' },
    { d: 0, en: 'never', ru: 'бессрочно' },
  ]

  const fmtDate = (d: Date | null) =>
    d ? new Intl.DateTimeFormat(ru ? 'ru' : 'en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(d)) : ru ? 'ни разу' : 'never'

  return (
    <div className="space-y-4">
      {/* Эндпоинт */}
      <div className={cardClass({ tone: 'inset', pad: 'sm' })}>
        <div className="mb-1 text-body-sm font-medium text-ink">{ru ? 'MCP-эндпоинт' : 'MCP endpoint'}</div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md bg-surface px-2 py-1 font-mono text-body-sm text-accent">{mcpUrl}</code>
          <Copyable text={mcpUrl} label={ru ? 'Копировать' : 'Copy'} />
        </div>
        <p className="mt-1.5 text-caption text-ink-2">
          {ru
            ? 'Подключи в клиенте как удалённый MCP-сервер, авторизация — Bearer-токеном ниже.'
            : 'Add it to your client as a remote MCP server; authenticate with a Bearer token below.'}
        </p>
      </div>

      {/* Показ только что созданного токена */}
      {created && (
        <div className={cardClass({ tone: 'warn', pad: 'sm' })}>
          <div className="mb-1 flex items-center gap-1.5 text-body-sm font-semibold text-warn">
            <TriangleAlert size={14} /> {ru ? 'Скопируй сейчас — больше не покажем' : 'Copy it now — shown only once'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full overflow-x-auto rounded-md bg-surface-2 px-2 py-1 font-mono text-body-sm text-ink">{created}</code>
            <Copyable text={created} label={ru ? 'Копировать токен' : 'Copy token'} />
          </div>
        </div>
      )}

      {/* Создание */}
      <div className="flex flex-wrap items-center gap-2">
        <Input value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              create()
            }
          }}
          placeholder="Claude Desktop" className="min-w-menu flex-1" />
        <Button variant="primary" size="md" onClick={create} disabled={pending || !name.trim()}>
          {pending ? <Spinner size="md" /> : <Plus size={14} />} {ru ? 'Создать токен' : 'Create token'}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-body-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-muted">{ru ? 'Доступ:' : 'Access:'}</span>
          <button type="button" onClick={() => setScope('write')} className={pill(scope === 'write')}>
            {ru ? 'чтение+запись' : 'read + write'}
          </button>
          <button type="button" onClick={() => setScope('read')} className={pill(scope === 'read')}>
            {ru ? 'только чтение' : 'read-only'}
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted">{ru ? 'Истекает:' : 'Expires:'}</span>
          {EXPIRY.map((e) => (
            <button key={e.d} type="button" onClick={() => setExpiryDays(e.d)} className={pill(expiryDays === e.d)}>
              {ru ? e.ru : e.en}
            </button>
          ))}
        </div>
      </div>
      {err && <p className="text-body-sm text-danger">{err}</p>}

      {/* Список */}
      {tokens.length === 0 ? (
        <p className="text-body text-muted">{ru ? 'Токенов пока нет.' : 'No tokens yet.'}</p>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {tokens.map((tk) => {
            const expired = !!tk.expiresAt && new Date(tk.expiresAt).getTime() < Date.now()
            return (
            <div key={tk.id} className="flex items-center gap-3 px-3 py-2.5">
              <KeyRound size={15} className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-body font-medium text-ink">{tk.name}</span>
                  <Badge className="uppercase tracking-wide">
                    {tk.scope === 'read' ? (ru ? 'чтение' : 'read') : (ru ? 'запись' : 'write')}
                  </Badge>
                  {expired && (
                    <Badge variant="danger" className="uppercase">{ru ? 'истёк' : 'expired'}</Badge>
                  )}
                </div>
                <div className="font-mono text-caption text-muted">
                  {tk.prefix} · {ru ? 'исп.' : 'used'} {fmtDate(tk.lastUsedAt)} ·{' '}
                  {tk.expiresAt ? `${ru ? 'истекает' : 'expires'} ${fmtDate(tk.expiresAt)}` : ru ? 'бессрочный' : 'no expiry'}
                </div>
              </div>
              <form action={revokeApiToken.bind(null, tk.id)}>
                <Tooltip label={revokeLabel}>
                  <IconButton type="submit" variant="danger" label={revokeLabel} className="hover:text-danger">
                    <Trash2 size={15} />
                  </IconButton>
                </Tooltip>
              </form>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
