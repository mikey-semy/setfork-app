import Link from 'next/link'
import { ArrowLeft, AtSign, Ban, Coins, Fingerprint, Flag, GitCommitVertical, KeyRound, LogOut, Mail, ShieldCheck, ShieldX, Trash2, Wrench } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { getAuditLog, type AuditEntry } from '@/features/admin/audit-queries'
import type { AuditAction } from '@/shared/audit'

export const dynamic = 'force-dynamic'

const META: Record<AuditAction, { icon: typeof KeyRound; ru: string; en: string; cls: string }> = {
  'maintenance.on': { icon: Wrench, ru: 'Сайт закрыт на обслуживание', en: 'Site closed for maintenance', cls: 'text-warn' },
  'maintenance.off': { icon: Wrench, ru: 'Сайт открыт после обслуживания', en: 'Site reopened after maintenance', cls: 'text-ok' },
  'monetization.settings': { icon: Coins, ru: 'Изменены настройки монетизации', en: 'Monetization settings changed', cls: 'text-warn' },
  'token.create': { icon: KeyRound, ru: 'Создан токен', en: 'Token created', cls: 'text-ink-2' },
  'token.revoke': { icon: Ban, ru: 'Отозван токен', en: 'Token revoked', cls: 'text-warn' },
  'list.delete': { icon: Trash2, ru: 'Удалён список', en: 'List deleted', cls: 'text-danger' },
  'list.moderate': { icon: ShieldX, ru: 'Модерация списка', en: 'List moderated', cls: 'text-warn' },
  'list.appeal': { icon: ShieldCheck, ru: 'Апелляция владельца', en: 'Moderation appeal', cls: 'text-accent' },
  'list.report': { icon: Flag, ru: 'Жалоба на список', en: 'List reported', cls: 'text-warn' },
  'list.verify': { icon: ShieldCheck, ru: 'Верификация списка', en: 'List verified', cls: 'text-ok' },
  'git.push': { icon: GitCommitVertical, ru: 'Push в список', en: 'Push to list', cls: 'text-ink-2' },
  'session.revoke': { icon: LogOut, ru: 'Отозвана сессия', en: 'Session revoked', cls: 'text-ink-2' },
  'session.revoke_others': { icon: LogOut, ru: 'Выход с др. устройств', en: 'Signed out others', cls: 'text-ink-2' },
  '2fa.enable': { icon: ShieldCheck, ru: 'Включена 2FA', en: '2FA enabled', cls: 'text-ok' },
  '2fa.disable': { icon: ShieldX, ru: 'Отключена 2FA', en: '2FA disabled', cls: 'text-warn' },
  '2fa.recovery-regenerate': { icon: KeyRound, ru: 'Новые recovery-коды', en: 'Recovery codes regenerated', cls: 'text-ink-2' },
  'password.reset': { icon: KeyRound, ru: 'Сброс пароля', en: 'Password reset', cls: 'text-warn' },
  'email.change-request': { icon: Mail, ru: 'Запрос смены почты', en: 'Email change requested', cls: 'text-ink-2' },
  'email.change': { icon: AtSign, ru: 'Смена почты', en: 'Email changed', cls: 'text-warn' },
  'passkey.add': { icon: Fingerprint, ru: 'Добавлен passkey', en: 'Passkey added', cls: 'text-ok' },
  'passkey.remove': { icon: Fingerprint, ru: 'Удалён passkey', en: 'Passkey removed', cls: 'text-warn' },
  'passkey.login': { icon: Fingerprint, ru: 'Вход по passkey', en: 'Passkey sign-in', cls: 'text-ink-2' },
  'account.delete': { icon: Trash2, ru: 'Удалён аккаунт', en: 'Account deleted', cls: 'text-danger' },
  'account.handle-change': { icon: AtSign, ru: 'Смена ника', en: 'Handle changed', cls: 'text-warn' },
}

function fmt(d: Date, ru: boolean): string {
  return new Intl.DateTimeFormat(ru ? 'ru-RU' : 'en-US', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

function metaText(e: AuditEntry): string {
  const keys = Object.keys(e.meta)
  if (keys.length === 0) return ''
  return keys
    .map((k) => {
      const v = e.meta[k]
      if (v === null || v === undefined || v === '') return null
      return `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`
    })
    .filter(Boolean)
    .join(' · ')
}

export const metadata = { title: 'Audit log' }

export default async function AuditPage() {
  await requireAdmin()
  const lang = await getLang()
  const ru = lang === 'ru'
  const entries = await getAuditLog(200)

  return (
    <div className="mx-auto w-full max-w-[960px] px-6 py-8">
      <Link href="/admin" className="mb-4 inline-flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> Admin
      </Link>
      <h1 className="mb-1 text-[18px] font-bold text-ink">{ru ? 'Журнал аудита' : 'Audit log'}</h1>
      <p className="mb-5 text-[13px] text-ink-2">
        {ru
          ? 'Чувствительные действия: токены, удаление и модерация списков, push, сессии. Последние 200 записей.'
          : 'Sensitive actions: tokens, list deletion & moderation, pushes, sessions. Last 200 entries.'}
      </p>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-[13px] text-muted">
          {ru ? 'Пока пусто.' : 'Nothing yet.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {entries.map((e, i) => {
            const m = META[e.action] ?? { icon: GitCommitVertical, ru: e.action, en: e.action, cls: 'text-ink-2' }
            const Icon = m.icon
            const details = metaText(e)
            return (
              <div
                key={e.id}
                className={`flex items-start gap-3 px-4 py-3 ${i > 0 ? 'border-t border-border' : ''}`}
              >
                <Icon size={16} className={`mt-0.5 shrink-0 ${m.cls}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[13px] font-semibold text-ink">{ru ? m.ru : m.en}</span>
                    {e.actorHandle ? (
                      <Link href={`/${e.actorHandle}`} className="text-[13px] text-primary hover:underline">
                        {e.actorHandle}
                      </Link>
                    ) : (
                      <span className="text-[13px] text-muted">{ru ? 'система' : 'system'}</span>
                    )}
                    {e.targetType && e.targetId ? (
                      <span className="font-mono text-[11.5px] text-muted">
                        {e.targetType}:{e.targetId.slice(0, 8)}
                      </span>
                    ) : null}
                  </div>
                  {details ? <div className="mt-0.5 truncate font-mono text-[11.5px] text-ink-2">{details}</div> : null}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[12px] tabular-nums text-ink-2">{fmt(e.createdAt, ru)}</div>
                  {e.ip ? <div className="font-mono text-[11px] text-muted">{e.ip}</div> : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
