import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { Avatar } from '@/shared/ui/Avatar'
import { getUsageByUser, getUsageTotals } from '@/shared/ai/usage'

const WINDOWS = [
  { days: 1, en: '24h', ru: '24ч' },
  { days: 7, en: '7d', ru: '7д' },
  { days: 30, en: '30d', ru: '30д' },
  { days: 0, en: 'All', ru: 'Всё' },
]

function money(n: number): string {
  return '$' + n.toFixed(n < 1 ? 4 : 2)
}
function num(n: number): string {
  return new Intl.NumberFormat('en').format(n)
}

export default async function AdminUsagePage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  await requireAdmin()
  const [lang, sp] = await Promise.all([getLang(), searchParams])
  const ru = lang === 'ru'
  const days = WINDOWS.some((w) => String(w.days) === sp.w) ? Number(sp.w) : 30
  const [rows, totals] = await Promise.all([getUsageByUser(days), getUsageTotals(days)])

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-5 px-6 py-8">
      <Link href="/admin" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft size={14} /> {ru ? 'К настройкам' : 'Back to settings'}
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mb-1 text-[18px] font-bold text-ink">{ru ? 'Расход ИИ' : 'AI usage'}</h1>
          <p className="text-[13px] text-ink-2">
            {ru
              ? 'Кто и на сколько сгенерировал — токены и деньги (фактическая стоимость OpenRouter).'
              : 'Who consumed what — tokens and money (actual OpenRouter cost).'}
          </p>
        </div>
        <div className="flex gap-1 rounded-md border border-border bg-surface-2 p-0.5">
          {WINDOWS.map((w) => (
            <Link
              key={w.days}
              href={`/admin/usage?w=${w.days}`}
              className={`rounded px-2.5 py-1 text-[12.5px] font-medium ${
                w.days === days ? 'bg-primary text-primary-fg' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {ru ? w.ru : w.en}
            </Link>
          ))}
        </div>
      </div>

      {/* Итог по сервису */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted">{ru ? 'Вызовов' : 'Calls'}</div>
          <div className="mt-1 text-[20px] font-bold text-ink">{num(totals.calls)}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted">{ru ? 'Токенов' : 'Tokens'}</div>
          <div className="mt-1 text-[20px] font-bold text-ink">{num(totals.totalTokens)}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted">{ru ? 'Стоимость' : 'Cost'}</div>
          <div className="mt-1 text-[20px] font-bold text-[var(--accent)]">{money(totals.costUsd)}</div>
        </div>
      </div>

      {/* По пользователям */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-border px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted">
          <span>{ru ? 'Пользователь' : 'User'}</span>
          <span className="text-right">{ru ? 'Вызовы' : 'Calls'}</span>
          <span className="text-right">{ru ? 'Токены' : 'Tokens'}</span>
          <span className="text-right">{ru ? 'Стоимость' : 'Cost'}</span>
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-muted">{ru ? 'Пока нет расхода.' : 'No usage yet.'}</div>
        ) : (
          rows.map((r) => (
            <div
              key={r.userId ?? 'system'}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b border-border px-4 py-2.5 last:border-0"
            >
              <span className="flex min-w-0 items-center gap-2">
                {r.handle ? (
                  <>
                    <Avatar handle={r.handle} avatarUrl={null} size={22} />
                    <Link href={`/${r.handle}`} className="truncate text-[13.5px] text-ink hover:text-accent">
                      {r.handle}
                    </Link>
                  </>
                ) : (
                  <span className="text-[13.5px] text-muted">{ru ? 'система / удалён' : 'system / deleted'}</span>
                )}
              </span>
              <span className="text-right font-mono text-[13px] text-ink-2">{num(r.calls)}</span>
              <span className="text-right font-mono text-[13px] text-ink-2">{num(r.totalTokens)}</span>
              <span className="text-right font-mono text-[13px] font-semibold text-ink">{money(r.costUsd)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
