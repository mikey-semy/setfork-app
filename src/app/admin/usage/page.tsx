import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { tr } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { getUsageByUser, getUsageTotals } from '@/shared/ai/usage'
import { getOpenRouterCredits } from '@/shared/ai/credits'
import { isQuarantined, modelHealth, QUARANTINE_WINDOW_MS } from '@/shared/ai/health'
import { assistEffect } from '@/features/runs/queries'

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

export const metadata = { title: 'Usage' }

export default async function AdminUsagePage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  await requireAdmin()
  const [lang, sp] = await Promise.all([getLang(), searchParams])
  const days = WINDOWS.some((w) => String(w.days) === sp.w) ? Number(sp.w) : 30
  const [rows, totals, credits, health, dayHealth, assist] = await Promise.all([
    getUsageByUser(days),
    getUsageTotals(days),
    getOpenRouterCredits(),
    // Щиток — вторичен: его сбой (см. инцидент со схемой 2026-07-21) не должен
    // ронять страницу расходов целиком.
    modelHealth((days || 30) * 24 * 3_600_000).catch(() => []), // «Всё» → окно 30д
    modelHealth(QUARANTINE_WINDOW_MS).catch(() => []), // карантин всегда по суткам
    assistEffect().catch(() => null), // «спутник» — вторичен, страницу не роняет
  ])
  const quarantinedNow = new Set(dayHealth.filter(isQuarantined).map((h) => h.model))

  // Осязаемость денег: во что обходится ОДНА генерация и на сколько ещё хватит остатка OpenRouter.
  // Средняя берётся за выбранное окно (совет = много вызовов, но один refId, поэтому делим на
  // число генераций, а не вызовов). Остаток / средняя = «сколько генераций ещё купим».
  const avgPerGen = totals.generations > 0 ? totals.costUsd / totals.generations : null
  const avgTokensPerGen = totals.generations > 0 ? Math.round(totals.totalTokens / totals.generations) : null
  const runwayGens = credits && avgPerGen && avgPerGen > 0 ? Math.floor(credits.remaining / avgPerGen) : null
  // Опциональный «токенов на генерацию»-хвост сноски: гейтим ЧИСЛОМ (без кириллицы в ветках тернарника,
  // иначе no-restricted-syntax), кириллица — только внутри tr().
  const tokN = avgTokensPerGen ? num(avgTokensPerGen) : ''
  const tokPart = tokN ? tr({ en: `, ~${tokN} tokens each`, ru: `, ~${tokN} токенов на генерацию` }, lang) : ''
  const footnote = tr(
    {
      en: `Rough estimate from this window's average. Generations in window: ${num(totals.generations)}${tokPart}. Cost varies per query.`,
      ru: `Оценка по средней за выбранный период. Генераций за период: ${num(totals.generations)}${tokPart}. На разных запросах цена гуляет — цифра грубая.`,
    },
    lang,
  )

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-5 px-6 py-8">
      <Link href="/admin" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft size={14} /> {tr({ en: 'Back to settings', ru: 'К настройкам' }, lang)}
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mb-1 text-[18px] font-bold text-ink">{tr({ en: 'Draft usage', ru: 'Расход на черновики' }, lang)}</h1>
          <p className="text-[13px] text-ink-2">
            {tr(
              {
                en: 'Who consumed what — tokens and money (actual OpenRouter cost).',
                ru: 'Кто и на сколько сгенерировал — токены и деньги (фактическая стоимость OpenRouter).',
              },
              lang,
            )}
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
              {tr({ en: w.en, ru: w.ru }, lang)}
            </Link>
          ))}
        </div>
      </div>

      {/* Итог по сервису */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted">{tr({ en: 'Calls', ru: 'Вызовов' }, lang)}</div>
          <div className="mt-1 text-[20px] font-bold text-ink">{num(totals.calls)}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted">{tr({ en: 'Tokens', ru: 'Токенов' }, lang)}</div>
          <div className="mt-1 text-[20px] font-bold text-ink">{num(totals.totalTokens)}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted">{tr({ en: 'Cost', ru: 'Стоимость' }, lang)}</div>
          <div className="mt-1 text-[20px] font-bold text-(--accent)">{money(totals.costUsd)}</div>
        </div>
      </div>

      {/* «Спутник исполнения»: сработала ли помощь — unblock rate (шаг стал done ПОСЛЕ подсказки).
          Это будущий аргумент ценности Pro: не «сколько сгенерили», а «скольким помогло». */}
      {assist && assist.hinted > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted">{tr({ en: 'Step assist', ru: 'Помощь на шаге' }, lang)}</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-[20px] font-bold text-ink">
              {Math.round((assist.unblocked / assist.hinted) * 100)}%
            </span>
            <span className="text-[13px] text-ink-2">
              {tr(
                {
                  en: `unblock rate — ${num(assist.unblocked)} of ${num(assist.hinted)} hinted steps got done afterwards`,
                  ru: `unblock rate — ${num(assist.unblocked)} из ${num(assist.hinted)} шагов с подсказкой затем пройдены`,
                },
                lang,
              )}
            </span>
          </div>
        </div>
      )}

      {/* Осязаемость: остаток OpenRouter → на сколько генераций хватит (по средней за период) */}
      {(credits || avgPerGen != null) && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
            {credits && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted">
                  {tr({ en: 'OpenRouter balance', ru: 'Остаток OpenRouter' }, lang)}
                </div>
                <div className="mt-1 text-[20px] font-bold text-ink">{money(credits.remaining)}</div>
              </div>
            )}
            {avgPerGen != null && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted">
                  {tr({ en: 'Avg / generation', ru: 'Средняя за генерацию' }, lang)}
                </div>
                <div className="mt-1 text-[20px] font-bold text-ink">{money(avgPerGen)}</div>
              </div>
            )}
            {runwayGens != null && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted">
                  {tr({ en: 'Balance affords', ru: 'Остатка хватит на' }, lang)}
                </div>
                <div className="mt-1 text-[20px] font-bold text-(--accent)">
                  ≈ {num(runwayGens)} {tr({ en: 'generations', ru: 'генераций' }, lang)}
                </div>
              </div>
            )}
          </div>
          {avgPerGen != null && <p className="mt-3 text-[12px] text-muted">{footnote}</p>}
        </div>
      )}

      {/* Щиток надёжности: success-rate и p95 по моделям; карантин = авторотация совета */}
      {health.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-2.5">
            <span className="text-[13px] font-semibold text-ink">{tr({ en: 'Model reliability', ru: 'Надёжность моделей' }, lang)}</span>
            <span className="ml-2 text-[12px] text-muted">
              {tr(
                {
                  en: 'quarantined models are auto-rotated out of the council pool (24h sliding window)',
                  ru: 'модели в карантине автоматически выпадают из пула совета (скользящие сутки)',
                },
                lang,
              )}
            </span>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 border-b border-border px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted">
            <span>{tr({ en: 'Model', ru: 'Модель' }, lang)}</span>
            <span className="text-right">{tr({ en: 'Calls', ru: 'Вызовы' }, lang)}</span>
            <span className="text-right">{tr({ en: 'Success', ru: 'Успех' }, lang)}</span>
            <span className="text-right">p95</span>
            <span className="text-right">{tr({ en: 'Status', ru: 'Статус' }, lang)}</span>
          </div>
          {[...health]
            .sort((a, b) => a.okRate - b.okRate || b.calls - a.calls)
            .map((h) => (
              <div key={h.model} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 border-b border-border px-4 py-2.5 last:border-0">
                <span className="truncate font-mono text-[12.5px] text-ink">{h.model}</span>
                <span className="text-right font-mono text-[13px] text-ink-2">{num(h.calls)}</span>
                <span className={`text-right font-mono text-[13px] font-semibold ${h.okRate >= 0.95 ? 'text-ok' : h.okRate >= 0.9 ? 'text-warn' : 'text-danger'}`}>
                  {(h.okRate * 100).toFixed(1)}%
                </span>
                <span className="text-right font-mono text-[13px] text-ink-2">{h.p95Ms ? `${(h.p95Ms / 1000).toFixed(1)}s` : '—'}</span>
                <span className="text-right">
                  {quarantinedNow.has(h.model) ? (
                    <span className="rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger">
                      {tr({ en: 'quarantine', ru: 'карантин' }, lang)}
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted">{tr({ en: 'in rotation', ru: 'в ротации' }, lang)}</span>
                  )}
                </span>
              </div>
            ))}
        </div>
      )}

      {/* По пользователям */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-border px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted">
          <span>{tr({ en: 'User', ru: 'Пользователь' }, lang)}</span>
          <span className="text-right">{tr({ en: 'Calls', ru: 'Вызовы' }, lang)}</span>
          <span className="text-right">{tr({ en: 'Tokens', ru: 'Токены' }, lang)}</span>
          <span className="text-right">{tr({ en: 'Cost', ru: 'Стоимость' }, lang)}</span>
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-muted">{tr({ en: 'No usage yet.', ru: 'Пока нет расхода.' }, lang)}</div>
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
                  <span className="text-[13.5px] text-muted">{tr({ en: 'system / deleted', ru: 'система / удалён' }, lang)}</span>
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
