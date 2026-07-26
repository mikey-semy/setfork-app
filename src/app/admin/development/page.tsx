import Link from 'next/link'
import { ArrowLeft, TrendingUp } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { tr, type Lang } from '@/shared/i18n'
import { getDevelopmentMetrics, UNAVAILABLE, type NaReason } from '@/features/admin/development-queries'
import { StatTile } from '@/shared/ui/StatTile'
import { TagChip } from '@/shared/ui/TagChip'

/**
 * Дашборд РАЗВИТИЯ (Ф-D0) — компания гномов, видимая сверху: куда движемся, а не
 * «что сейчас» (это /admin/dashboard). Страница детерминированная: только SELECT,
 * ни одного вызова модели — открытие не стоит денег.
 *
 * Где источника нет — честное «—» с причиной (ADR-0005), а не ноль и не оценка.
 */

export const metadata = { title: 'Development' }
export const dynamic = 'force-dynamic' // накопленные числа, без ISR-кэша

const num = (n: number) => new Intl.NumberFormat('en').format(n)
const usd = (n: number) => '$' + n.toFixed(2)
const pct = (v: number) => Math.round(v * 100) + '%'

/** Почему метрика пуста — человеческим языком, с указанием, что её откроет. */
function naText(reason: NaReason, lang: Lang): string {
  if (reason === 'no-payments-table')
    return tr({ en: 'no source: no payments table yet', ru: 'нет источника: таблицы платежей ещё нет' }, lang)
  if (reason === 'no-created-at')
    return tr({ en: 'no source: roster has no hire date', ru: 'нет источника: у ростера нет даты найма' }, lang)
  return tr({ en: 'no source: domains are not a taxonomy yet', ru: 'нет источника: домены пока не таксономия' }, lang)
}

const h2 = 'text-[13px] font-semibold uppercase tracking-wide text-ink-2'

export default async function AdminDevelopmentPage() {
  await requireAdmin()
  const lang = await getLang()
  const m = await getDevelopmentMetrics(30)
  const period = tr({ en: `in ${m.periodDays} days`, ru: `за ${m.periodDays} дн.` }, lang)

  return (
    <div className="mx-auto flex w-full max-w-[1040px] min-w-0 flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {/* -ml-2/px-2 + py-2.5 — тач-цель ≥44px, но визуально ссылка остаётся на месте. */}
          <Link href="/admin" className="-ml-2 mb-0.5 inline-flex w-fit items-center gap-1.5 px-2 py-2.5 text-[13px] text-ink-2 hover:text-ink">
            <ArrowLeft size={14} /> {tr({ en: 'Back to settings', ru: 'К настройкам' }, lang)}
          </Link>
          <h1 className="flex items-center gap-2 text-[18px] font-bold text-ink">
            <TrendingUp size={17} /> {tr({ en: 'Development', ru: 'Развитие' }, lang)}
          </h1>
          <p className="text-[13px] text-ink-2">
            {tr(
              {
                en: 'Where we are heading: library, quality, spend, corpus, staff. Accumulated — not live monitoring.',
                ru: 'Куда движемся: библиотека, качество, расход, корпус, штат. Накопленное — не живой мониторинг.',
              },
              lang,
            )}
          </p>
        </div>
        <Link href="/admin/dashboard" className="-mr-2 inline-flex items-center px-2 py-2.5 text-[13px] text-accent hover:underline">
          {tr({ en: 'Live monitoring →', ru: 'Живой мониторинг →' }, lang)}
        </Link>
      </div>

      {/* Рост библиотеки */}
      <section className="flex min-w-0 flex-col gap-3">
        <h2 className={h2}>{tr({ en: 'Library', ru: 'Библиотека' }, lang)}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label={tr({ en: 'Public lists', ru: 'Публичных списков' }, lang)} value={num(m.library.published)} />
          <StatTile label={tr({ en: 'New', ru: 'Новых' }, lang)} value={num(m.library.newInPeriod)} hint={period} tone="ok" />
          <StatTile label={tr({ en: 'Forks', ru: 'Форков' }, lang)} value={num(m.library.forks)} />
          <StatTile label={tr({ en: 'Drafts', ru: 'Черновиков' }, lang)} value={num(m.library.drafts)} />
        </div>
      </section>

      {/* Качество: польза для людей + вклад садовника */}
      <section className="flex min-w-0 flex-col gap-3">
        <h2 className={h2}>{tr({ en: 'Quality', ru: 'Качество' }, lang)}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label={tr({ en: 'Stars', ru: 'Звёзд' }, lang)} value={num(m.quality.stars)} />
          <StatTile label={tr({ en: 'Runs', ru: 'Прогонов' }, lang)} value={num(m.quality.runs)} />
          <StatTile
            label={tr({ en: 'Improved', ru: 'Улучшено' }, lang)}
            value={num(m.quality.gardenerAccepted)}
            hint={tr({ en: 'edits accepted', ru: 'правок принято' }, lang)}
            tone={m.quality.gardenerAccepted > 0 ? 'ok' : 'ink'}
          />
          <StatTile
            label={tr({ en: 'Awaiting review', ru: 'Ждут ревью' }, lang)}
            value={num(m.quality.gardenerOpen)}
            hint={tr({ en: `on ${m.quality.listsImproved} lists`, ru: `на ${m.quality.listsImproved} списках` }, lang)}
            tone={m.quality.gardenerOpen > 0 ? 'warn' : 'ink'}
            href="/admin/moderation"
          />
        </div>
      </section>

      {/* Деньги: только расход — выручки в схеме нет */}
      <section className="flex min-w-0 flex-col gap-3">
        <h2 className={h2}>{tr({ en: 'Money', ru: 'Деньги' }, lang)}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={tr({ en: 'Burn today', ru: 'Расход сегодня' }, lang)}
            value={usd(m.money.burnToday)}
            hint={m.money.dailyCap > 0 ? tr({ en: `cap ${usd(m.money.dailyCap)}`, ru: `кап ${usd(m.money.dailyCap)}` }, lang) : tr({ en: 'no cap', ru: 'без капа' }, lang)}
            tone={m.money.dailyCap > 0 && m.money.burnToday >= m.money.dailyCap * 0.8 ? 'warn' : 'ink'}
          />
          <StatTile label={tr({ en: 'Burn', ru: 'Расход' }, lang)} value={usd(m.money.burnPeriod)} hint={period} />
          {m.money.balance == null ? (
            <StatTile label={tr({ en: 'Balance', ru: 'Остаток' }, lang)} na={tr({ en: 'provider endpoint unavailable', ru: 'эндпоинт провайдера недоступен' }, lang)} />
          ) : (
            <StatTile label={tr({ en: 'Balance', ru: 'Остаток' }, lang)} value={usd(m.money.balance)} href="/admin/usage" />
          )}
          <StatTile label={tr({ en: 'Margin', ru: 'Маржа' }, lang)} na={naText(UNAVAILABLE.margin, lang)} />
        </div>
        {m.money.runwayGens != null && (
          <p className="text-[12px] text-muted">
            {tr(
              { en: `Balance affords ≈${num(m.money.runwayGens)} more generations at the 30-day average.`, ru: `Остатка хватит ≈на ${num(m.money.runwayGens)} генераций по средней за 30 дней.` },
              lang,
            )}
          </p>
        )}
      </section>

      {/* Корпус знаний */}
      <section className="flex min-w-0 flex-col gap-3">
        <h2 className={h2}>{tr({ en: 'Knowledge corpus', ru: 'Корпус знаний' }, lang)}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label={tr({ en: 'Facts', ru: 'Фактов' }, lang)} value={num(m.corpus.triples)} hint={tr({ en: 'KAG triples', ru: 'KAG-тройки' }, lang)} />
          <StatTile label={tr({ en: 'New facts', ru: 'Новых фактов' }, lang)} value={num(m.corpus.triplesNewInPeriod)} hint={period} tone="ok" />
          <StatTile
            label={tr({ en: 'Lists mined', ru: 'Списков добыто' }, lang)}
            value={num(m.corpus.listsMined)}
            hint={tr({ en: `of ${m.library.published} public`, ru: `из ${m.library.published} публичных` }, lang)}
          />
          <StatTile label={tr({ en: 'Domain coverage', ru: 'Покрытие доменов' }, lang)} na={naText(UNAVAILABLE.domainCoverage, lang)} />
        </div>
      </section>

      {/* Штат */}
      <section className="flex min-w-0 flex-col gap-3">
        <h2 className={h2}>{tr({ en: 'Staff', ru: 'Штат' }, lang)}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={tr({ en: 'Active', ru: 'В строю' }, lang)}
            value={num(m.roster.enabled)}
            hint={tr({ en: `of ${m.roster.total} in roster`, ru: `из ${m.roster.total} в ростере` }, lang)}
            href="/admin/council"
          />
          <StatTile label={tr({ en: 'New professions', ru: 'Новых профессий' }, lang)} na={naText(UNAVAILABLE.newProfessions, lang)} />
          <StatTile label={tr({ en: 'Growth topics', ru: 'Тем роста' }, lang)} value={num(m.topics.length)} hint={tr({ en: 'raw signal', ru: 'сырой сигнал' }, lang)} tone={m.topics.length > 0 ? 'accent' : 'ink'} />
        </div>

        {/* Участие в совете — таблица столбцами (как щиток надёжности моделей).
            Скроллится КОНТЕЙНЕР (overflow-x-auto + min-w), страница — никогда.
            Долю НЕ красим: это участие, а не победы (атрибуция общая, см. development-queries). */}
        {m.gnomes.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-4 py-2.5">
              <span className="text-[13px] font-semibold text-ink">{tr({ en: 'Council participation', ru: 'Участие в совете' }, lang)}</span>
              <span className="ml-2 text-[12px] text-muted">
                {tr(
                  {
                    en: 'acceptance counts for every drafter — participation, not a win rate',
                    ru: 'принятие засчитывается всем, кто дал черновик, — участие, а не победы',
                  },
                  lang,
                )}
              </span>
            </div>
            <div className="grid min-w-[520px] grid-cols-[1fr_auto_auto_auto_auto] gap-4 border-b border-border px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted">
              <span>{tr({ en: 'Gnome', ru: 'Гном' }, lang)}</span>
              <span className="text-right">{tr({ en: 'Rank', ru: 'Ранг' }, lang)}</span>
              <span className="text-right">{tr({ en: 'Councils', ru: 'Советов' }, lang)}</span>
              <span className="text-right">{tr({ en: 'Accepted', ru: 'Принято' }, lang)}</span>
              <span className="text-right">{tr({ en: 'Share', ru: 'Доля' }, lang)}</span>
            </div>
            {m.gnomes.map((g) => (
              <Link
                key={g.id}
                href={`/admin/council/${g.id}`}
                className="grid min-w-[520px] grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 border-b border-border px-4 py-3 hover:bg-surface-2"
              >
                <span className="truncate text-[13px] font-medium text-ink">{lang === 'ru' ? g.nameRu : g.nameEn}</span>
                <span className="text-right text-[12px] text-muted">{lang === 'ru' ? g.rankRu : g.rankEn}</span>
                <span className="text-right font-mono text-[13px] tabular-nums text-ink-2">{num(g.gens)}</span>
                <span className="text-right font-mono text-[13px] tabular-nums text-ink-2">{num(g.accepted)}</span>
                <span className="text-right font-mono text-[13px] tabular-nums text-ink-2">{g.trusted ? pct(g.score) : '—'}</span>
              </Link>
            ))}
            <div className="px-4 py-2.5 text-[11.5px] text-muted">
              {tr(
                { en: '«—» = too few councils to trust the number.', ru: '«—» = советов слишком мало, чтобы верить цифре.' },
                lang,
              )}
            </div>
          </div>
        )}

        {/* Темы роста — чем компания не покрыта (сигнал найма) */}
        {m.topics.length > 0 && (
          <div className="min-w-0 rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-4 py-2.5">
              <span className="text-[13px] font-semibold text-ink">{tr({ en: 'Uncovered topics', ru: 'Непокрытые темы' }, lang)}</span>
              <span className="ml-2 text-[12px] text-muted">
                {tr(
                  { en: 'the generalist covered these with no specialist for them', ru: 'их тянул универсал без профильного специалиста' },
                  lang,
                )}
              </span>
            </div>
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {m.topics.map((s) => (
                <TagChip key={s.tag} slug={s.tag} count={s.n} />
              ))}
            </div>
            <div className="px-4 pb-3 text-[11.5px] text-muted">
              {tr(
                {
                  en: 'Raw signal from draft tags — not a normalized taxonomy. Hiring lives in the council hall.',
                  ru: 'Сырой сигнал из тегов черновиков — не нормализованная таксономия. Найм — в зале совета.',
                },
                lang,
              )}
            </div>
          </div>
        )}
      </section>

      <p className="text-[12px] text-muted">
        {tr(
          {
            en: 'Read-only page: it aggregates what is already stored and never calls a model. «—» means the source does not exist yet, not zero.',
            ru: 'Страница только читает: агрегирует уже собранное и не зовёт модель. «—» значит источника ещё нет, а не ноль.',
          },
          lang,
        )}
      </p>
    </div>
  )
}
