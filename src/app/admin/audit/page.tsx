import Link from 'next/link'
import { AtSign, Ban, Coins, Fingerprint, Flag, GitCommitVertical, KeyRound, Link2, LogOut, Mail, ShieldCheck, ShieldX, Trash2, Unlink, Wrench } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t, type Lang, type TKey } from '@/shared/i18n'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { getAuditLogPage, type AuditEntry } from '@/features/admin/audit-queries'
import { Pagination } from '@/shared/ui/Pagination'
import { AFTER_PARAM, AUDIT_PER_PAGE, BEFORE_PARAM, cursorHref, readCursor } from '@/shared/lib/paging'
import type { AuditAction } from '@/shared/audit'

export const dynamic = 'force-dynamic'

const META: Record<AuditAction, { icon: typeof KeyRound; label: TKey; cls: string }> = {
  'maintenance.on': { icon: Wrench, label: 'audit.maintenanceOn', cls: 'text-warn' },
  'maintenance.off': { icon: Wrench, label: 'audit.maintenanceOff', cls: 'text-ok' },
  'monetization.settings': { icon: Coins, label: 'audit.monetizationSettings', cls: 'text-warn' },
  'token.create': { icon: KeyRound, label: 'audit.tokenCreate', cls: 'text-ink-2' },
  'token.revoke': { icon: Ban, label: 'audit.tokenRevoke', cls: 'text-warn' },
  'list.delete': { icon: Trash2, label: 'audit.listDelete', cls: 'text-danger' },
  'list.moderate': { icon: ShieldX, label: 'audit.listModerate', cls: 'text-warn' },
  'list.appeal': { icon: ShieldCheck, label: 'audit.listAppeal', cls: 'text-accent' },
  'list.report': { icon: Flag, label: 'audit.listReport', cls: 'text-warn' },
  'list.verify': { icon: ShieldCheck, label: 'audit.listVerify', cls: 'text-ok' },
  'list.transfer-init': { icon: GitCommitVertical, label: 'audit.listTransferInit', cls: 'text-warn' },
  'list.transfer-accept': { icon: GitCommitVertical, label: 'audit.listTransferAccept', cls: 'text-warn' },
  'git.push': { icon: GitCommitVertical, label: 'audit.gitPush', cls: 'text-ink-2' },
  'git.suggest': { icon: GitCommitVertical, label: 'audit.gitSuggest', cls: 'text-ink-2' },
  'session.revoke': { icon: LogOut, label: 'audit.sessionRevoke', cls: 'text-ink-2' },
  'session.revoke_others': { icon: LogOut, label: 'audit.sessionRevoke_others', cls: 'text-ink-2' },
  '2fa.enable': { icon: ShieldCheck, label: 'audit.2faEnable', cls: 'text-ok' },
  '2fa.disable': { icon: ShieldX, label: 'audit.2faDisable', cls: 'text-warn' },
  '2fa.recovery-regenerate': { icon: KeyRound, label: 'audit.2faRecoveryRegenerate', cls: 'text-ink-2' },
  'password.reset': { icon: KeyRound, label: 'audit.passwordReset', cls: 'text-warn' },
  'email.change-request': { icon: Mail, label: 'audit.emailChangeRequest', cls: 'text-ink-2' },
  'email.change': { icon: AtSign, label: 'audit.emailChange', cls: 'text-warn' },
  'passkey.add': { icon: Fingerprint, label: 'audit.passkeyAdd', cls: 'text-ok' },
  'passkey.remove': { icon: Fingerprint, label: 'audit.passkeyRemove', cls: 'text-warn' },
  'passkey.login': { icon: Fingerprint, label: 'audit.passkeyLogin', cls: 'text-ink-2' },
  'account.delete': { icon: Trash2, label: 'audit.accountDelete', cls: 'text-danger' },
  'account.handle-change': { icon: AtSign, label: 'audit.accountHandleChange', cls: 'text-warn' },
  'auth.identity-link': { icon: Link2, label: 'audit.identityLink', cls: 'text-ok' },
  'auth.identity-unlink': { icon: Unlink, label: 'audit.identityUnlink', cls: 'text-warn' },
}

function fmt(d: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(lang, {
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

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('adminAudit', lang) }
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ after?: string; before?: string }> }) {
  const sp = await searchParams
  // Журнал листается КЛЮЧОМ: он пополняется сверху непрерывно, и смещение здесь давало бы
  // не медленную выдачу, а неверную. Пропущенная запись аудита читается как «действия не
  // было» — цена ошибки выше, чем где-либо ещё.
  const { cursor, dir } = readCursor(sp)
  // Проверка прав, язык и сам журнал независимы — ждём их разом, а не по очереди
  // (React Doctor: server-sequential-independent-await).
  const [, lang, log] = await Promise.all([
    requireAdmin(),
    getLang(),
    getAuditLogPage(AUDIT_PER_PAGE, cursor, dir),
  ])
  const entries = log.items

  return (
    <div className="min-w-0">
      <PageHeader
        title={t('audit.title', lang)}
        subtitle={t('audit.subtitle', lang)}
      />

      {entries.length === 0 ? (
        <EmptyState variant="plain" hint={t('audit.empty', lang)} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {entries.map((e, i) => {
            const m = META[e.action]
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
                    <span className="text-body font-semibold text-ink">{t(m.label, lang)}</span>
                    {e.actorHandle ? (
                      <Link href={`/${e.actorHandle}`} className="text-body text-primary hover:underline">
                        {e.actorHandle}
                      </Link>
                    ) : (
                      <span className="text-body text-muted">{t('audit.system', lang)}</span>
                    )}
                    {e.targetType && e.targetId ? (
                      <span className="font-mono text-caption text-muted">
                        {e.targetType}:{e.targetId.slice(0, 8)}
                      </span>
                    ) : null}
                  </div>
                  {details ? <div className="mt-0.5 truncate font-mono text-caption text-ink-2">{details}</div> : null}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-body-sm tabular-nums text-ink-2">{fmt(e.createdAt, lang)}</div>
                  {e.ip ? <div className="font-mono text-caption text-muted">{e.ip}</div> : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <Pagination
        lang={lang}
        steps={{
          prev: log.prev ? cursorHref('/admin/audit', sp, BEFORE_PARAM)(log.prev) : null,
          next: log.next ? cursorHref('/admin/audit', sp, AFTER_PARAM)(log.next) : null,
        }}
      />
    </div>
  )
}
