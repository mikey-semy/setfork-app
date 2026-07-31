'use client'

import { useTransition } from 'react'
import { Loader2, Monitor, Smartphone } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Tooltip } from '@/shared/ui/Tooltip'
import type { UserSession } from './queries'
import { revokeOtherSessions, revokeSession } from './actions'

export function SessionsList({ sessions, lang }: { sessions: UserSession[]; lang: Lang }) {
  const [pending, start] = useTransition()
  const fmt = new Intl.DateTimeFormat(lang, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  const day = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' })
  const others = sessions.filter((s) => !s.current).length

  return (
    <div className="flex flex-col gap-2.5">
      {sessions.map((s) => {
        const mobile = /Android|iOS/.test(s.device)
        const stale = !s.current && !s.online && s.stale
        const Icon = mobile ? Smartphone : Monitor
        return (
        <div key={s.id} className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
          <Icon size={18} className="shrink-0 text-ink-2" />
          <div className="min-w-0 flex-1 text-[0.8125rem]">
            <div className="flex items-center gap-2 font-medium text-ink">
              {s.device}
              {s.current ? (
                <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[0.6875rem] font-semibold text-ok">
                  {t('currentSession', lang)}
                </span>
              ) : s.online ? (
                <Tooltip label={t('onlineLabel', lang)}>
                  <span className="h-2 w-2 rounded-full bg-ok" />
                </Tooltip>
              ) : stale ? (
                <span className="rounded-full bg-surface px-2 py-0.5 text-[0.6875rem] font-semibold text-muted">{t('staleLabel', lang)}</span>
              ) : null}
            </div>
            <div className="text-[0.78125rem] text-muted">
              {/* Гео как «Seen in …» у GitHub; IP оставляем для точности. */}
              {s.geo ? `${s.geo} · ${s.ip ?? '—'}` : (s.ip ?? '—')} · {t('lastSeen', lang)} {fmt.format(new Date(s.lastSeenAt))} · {t('signedInLabel', lang)} {day.format(new Date(s.createdAt))}
            </div>
          </div>
          {!s.current && (
            <button
              type="button"
              onClick={() => start(() => revokeSession(s.id))}
              disabled={pending}
              className="shrink-0 rounded-md border border-border px-3 py-1.5 text-[0.78125rem] font-medium text-ink-2 hover:border-danger hover:text-danger disabled:opacity-60"
            >
              {t('revoke', lang)}
            </button>
          )}
        </div>
        )
      })}

      {others > 0 && (
        <button
          type="button"
          onClick={() => start(() => revokeOtherSessions())}
          disabled={pending}
          className="mt-1 inline-flex w-fit items-center gap-2 rounded-md border border-danger/40 px-3.5 py-2 text-[0.8125rem] font-semibold text-danger hover:bg-danger/5 disabled:opacity-60"
        >
          {pending && <Loader2 size={14} className="animate-spin" />}
          {t('signOutOthers', lang)}
        </button>
      )}
    </div>
  )
}
