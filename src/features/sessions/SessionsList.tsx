'use client'

import { useTransition } from 'react'
import { Loader2, Monitor } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import type { UserSession } from './queries'
import { revokeOtherSessions, revokeSession } from './actions'

export function SessionsList({ sessions, lang }: { sessions: UserSession[]; lang: Lang }) {
  const [pending, start] = useTransition()
  const fmt = new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  const others = sessions.filter((s) => !s.current).length

  return (
    <div className="flex flex-col gap-2.5">
      {sessions.map((s) => (
        <div key={s.id} className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
          <Monitor size={18} className="shrink-0 text-ink-2" />
          <div className="min-w-0 flex-1 text-[13px]">
            <div className="flex items-center gap-2 font-medium text-ink">
              {s.device}
              {s.current && (
                <span className="rounded-full bg-[var(--ok)]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[var(--ok)]">
                  {t('currentSession', lang)}
                </span>
              )}
              {s.online && !s.current && <span className="h-2 w-2 rounded-full bg-[var(--ok)]" title={t('onlineLabel', lang)} />}
            </div>
            <div className="text-[12px] text-muted">
              {s.ip ?? '—'} · {t('lastSeen', lang)} {fmt.format(new Date(s.lastSeenAt))}
            </div>
          </div>
          {!s.current && (
            <button
              onClick={() => start(() => revokeSession(s.id))}
              disabled={pending}
              className="shrink-0 rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-ink-2 hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:opacity-60"
            >
              {t('revoke', lang)}
            </button>
          )}
        </div>
      ))}

      {others > 0 && (
        <button
          onClick={() => start(() => revokeOtherSessions())}
          disabled={pending}
          className="mt-1 inline-flex w-fit items-center gap-2 rounded-md border border-[var(--danger)]/40 px-3.5 py-2 text-[13px] font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/5 disabled:opacity-60"
        >
          {pending && <Loader2 size={14} className="animate-spin" />}
          {t('signOutOthers', lang)}
        </button>
      )}
    </div>
  )
}
