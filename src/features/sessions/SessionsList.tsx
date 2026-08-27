'use client'

import { useTransition } from 'react'
import { Monitor, Smartphone } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Tooltip } from '@/shared/ui/Tooltip'
import type { UserSession } from './queries'
import { revokeOtherSessions, revokeSession } from './actions'
import { buttonClass } from '@/shared/ui/button-style'
import { Spinner } from '@/shared/ui/Spinner'
import { Badge } from '@/shared/ui/badge'

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
          <div className="min-w-0 flex-1 text-body">
            <div className="flex items-center gap-2 font-medium text-ink">
              {s.device}
              {s.current ? (
                <Badge variant="ok">
                  {t('currentSession', lang)}
                </Badge>
              ) : s.online ? (
                <Tooltip label={t('onlineLabel', lang)}>
                  <span className="h-2 w-2 rounded-full bg-ok" />
                </Tooltip>
              ) : stale ? (
                <Badge variant="soft">{t('staleLabel', lang)}</Badge>
              ) : null}
            </div>
            <div className="text-body-sm text-muted">
              {/* Гео как «Seen in …» у GitHub; IP оставляем для точности. */}
              {s.geo ? `${s.geo} · ${s.ip ?? '—'}` : (s.ip ?? '—')} · {t('lastSeen', lang)} {fmt.format(new Date(s.lastSeenAt))} · {t('signedInLabel', lang)} {day.format(new Date(s.createdAt))}
            </div>
          </div>
          {!s.current && (
            <button
              type="button"
              onClick={() => start(() => revokeSession(s.id))}
              disabled={pending}
              className={buttonClass({ variant: 'danger', className: 'hover:border-danger hover:text-danger disabled:opacity-60' })}
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
          className={buttonClass({ variant: 'dangerSolid', className: 'mt-1 w-fit hover:bg-danger/5 disabled:opacity-60' })}
        >
          {pending && <Spinner size="md" />}
          {t('signOutOthers', lang)}
        </button>
      )}
    </div>
  )
}
