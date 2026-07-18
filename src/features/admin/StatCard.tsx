import type { ReactNode } from 'react'

/**
 * Плитка-показатель дашборда: подпись сверху, крупное число, опциональный подтекст. Без хуков —
 * рендерится и на сервере (страница), и внутри клиентского DashboardLive. Паттерн карточки взят
 * из admin/usage (rounded-lg border bg-surface p-4), вынесен сюда, т.к. на дашборде их ~14.
 */
export function StatCard({
  label,
  value,
  sub,
  tone = 'ink',
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  tone?: 'ink' | 'accent' | 'ok' | 'warn' | 'danger'
}) {
  const valueColor =
    tone === 'accent'
      ? 'text-(--accent)'
      : tone === 'ok'
        ? 'text-ok'
        : tone === 'warn'
          ? 'text-warn'
          : tone === 'danger'
            ? 'text-danger'
            : 'text-ink'
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-[22px] font-bold tabular-nums ${valueColor}`}>{value}</div>
      {sub != null && <div className="mt-0.5 text-[12px] text-muted">{sub}</div>}
    </div>
  )
}
