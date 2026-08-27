import Link from 'next/link'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { PageHeader } from '@/shared/ui/PageHeader'
import { StatTile } from '@/shared/ui/StatTile'
import { UsageByUserTable } from '@/features/admin/UsageByUserTable'
import { UsageModelsTable } from '@/features/admin/UsageModelsTable'
import { getUsageByUser, getUsageTotals } from '@/shared/ai/usage'
import { getOpenRouterCredits } from '@/shared/ai/credits'
import { isQuarantined, modelHealth, QUARANTINE_WINDOW_MS } from '@/shared/ai/health'
import { prettyModelName } from '@/shared/ai/models'
import { cardClass } from '@/shared/ui/card-style'
import { Segment, SegmentedControl } from '@/shared/ui/SegmentedControl'

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

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('aiUsageTitle', lang) }
}

export default async function AdminUsagePage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  await requireAdmin()
  const [lang, sp] = await Promise.all([getLang(), searchParams])
  const days = WINDOWS.some((w) => String(w.days) === sp.w) ? Number(sp.w) : 30
  const [rows, totals, credits, health, dayHealth] = await Promise.all([
    getUsageByUser(days),
    getUsageTotals(days),
    getOpenRouterCredits(),
    // Щиток — вторичен: его сбой (см. инцидент со схемой 2026-07-21) не должен
    // ронять страницу расходов целиком.
    modelHealth((days || 30) * 24 * 3_600_000).catch(() => []), // «Всё» → окно 30д
    modelHealth(QUARANTINE_WINDOW_MS).catch(() => []), // карантин всегда по суткам
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
  const tokPart = tokN ? t('admin.tokensEach', lang).replace('{n}', tokN) : ''
  const footnote = t('admin.usageFootnote', lang).replace('{n}', num(totals.generations)).replace('{t}', tokPart)

  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      <PageHeader
        title={t('admin.draftUsage', lang)}
        subtitle={t('admin.whoConsumedWhatTokens', lang)}
        actions={
          <SegmentedControl label={t('admin.period', lang)}>
            {WINDOWS.map((w) => (
              <Segment key={w.days} active={w.days === days} href={`/admin/usage?w=${w.days}`}>
                {tr({ en: w.en, ru: w.ru }, lang)}
              </Segment>
            ))}
          </SegmentedControl>
        }
      />

      {/* Итог по сервису */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile label={t('admin.calls', lang)} value={num(totals.calls)} />
        <StatTile label={t('admin.tokens', lang)} value={num(totals.totalTokens)} />
        <StatTile label={t('admin.cost', lang)} value={money(totals.costUsd)} tone="accent" />
      </div>

      {/* Осязаемость: остаток OpenRouter → на сколько генераций хватит (по средней за период) */}
      {(credits || avgPerGen != null) && (
        <div className={cardClass()}>
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
            {credits && (
              <div>
                <div className="text-caption uppercase tracking-wide text-muted">
                  {t('admin.openRouterBalance', lang)}
                </div>
                <div className="mt-1 text-heading font-bold text-ink">{money(credits.remaining)}</div>
              </div>
            )}
            {avgPerGen != null && (
              <div>
                <div className="text-caption uppercase tracking-wide text-muted">
                  {t('admin.avgGeneration', lang)}
                </div>
                <div className="mt-1 text-heading font-bold text-ink">{money(avgPerGen)}</div>
              </div>
            )}
            {runwayGens != null && (
              <div>
                <div className="text-caption uppercase tracking-wide text-muted">
                  {t('admin.balanceAffords', lang)}
                </div>
                <div className="mt-1 text-heading font-bold text-accent">
                  ≈ {num(runwayGens)} {t('admin.generations', lang)}
                </div>
              </div>
            )}
          </div>
          {avgPerGen != null && <p className="mt-3 text-body-sm text-muted">{footnote}</p>}
        </div>
      )}

      {/* Щиток надёжности: success-rate и p95 по моделям; карантин = авторотация совета */}
      {health.length > 0 && (
        <div className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-2.5">
            <span className="text-body font-semibold text-ink">{t('admin.modelReliability', lang)}</span>
            <span className="ml-2 text-body-sm text-muted">
              {t('admin.quarantinedModelsAutoRotated', lang)}
            </span>
          </div>
          {/* Титульная полоса остаётся снаружи скролла: таблица внутри без своей рамки. */}
          <UsageModelsTable
            lang={lang}
            rows={[...health]
              .sort((a, b) => a.okRate - b.okRate || b.calls - a.calls)
              .map((h) => ({
                model: h.model,
                name: prettyModelName(h.model),
                calls: h.calls,
                okRate: h.okRate,
                p95Ms: h.p95Ms ? h.p95Ms : null,
                quarantined: quarantinedNow.has(h.model),
              }))}
          />
        </div>
      )}

      {/* По пользователям */}
      <UsageByUserTable
        lang={lang}
        rows={rows.map((r) => ({ userId: r.userId, handle: r.handle, calls: r.calls, totalTokens: r.totalTokens, costUsd: r.costUsd }))}
      />
    </div>
  )
}
