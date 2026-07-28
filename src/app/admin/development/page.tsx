import Link from 'next/link'
import { ArrowLeft, Check, Pause, Play, TrendingUp, X } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { tr, type Lang } from '@/shared/i18n'
import { getCompanyDay, getDevelopmentMetrics, UNAVAILABLE, type NaReason } from '@/features/admin/development-queries'
import { currentAgenda } from '@/features/partners/service'
import { agendaLabel, type AgendaKind } from '@/shared/agents/agenda'
import { decideAgendaItem } from '@/features/admin/agenda-actions'
import { getDomainScorecards } from '@/features/admin/scorecard-queries'
import { StatTile } from '@/shared/ui/StatTile'
import { TagChip } from '@/shared/ui/TagChip'
import { AUTONOMOUS_LOOPS, allLoopPolicies } from '@/shared/agents/policy'
import { stallReports } from '@/shared/agents/stall'
import { resetLoopCircuit, toggleLoopDryRun, toggleLoopPause } from '@/features/admin/actions'

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

// Столбцы лент фиксированной ширины: `auto` подгоняется под содержимое КАЖДОЙ строки, и шапка
// со строками разъезжаются «волной» (за это уже досталось на щитке моделей).
const FEED_COLS = 'grid-cols-[minmax(0,1fr)_92px_84px_104px_88px_112px]'

const AGENDA_COLS = 'grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_96px_128px]'

export default async function AdminDevelopmentPage() {
  await requireAdmin()
  const lang = await getLang()
  const [m, loops, today, yesterday, cards, stalls, agenda] = await Promise.all([
    getDevelopmentMetrics(30),
    allLoopPolicies(),
    getCompanyDay(0),
    getCompanyDay(1),
    getDomainScorecards(),
    stallReports(AUTONOMOUS_LOOPS),
    currentAgenda(),
  ])
  const period = tr({ en: `in ${m.periodDays} days`, ru: `за ${m.periodDays} дн.` }, lang)

  return (
    <div className="flex w-full min-w-0 flex-col gap-6 px-5 py-6 md:px-8">
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

      {/* ХОЛОСТОЙ ХОД: петля работает, деньги идут, а библиотека не меняется. «Улучшать
          нечего» — законный режим (он ведёт к расхождению форком), поэтому это не тревога
          предохранителя, а строка отчёта: узнать надо раньше, чем из счёта за модель. */}
      {Object.entries(stalls).some(([, r]) => r.stalled) && (
        <section className="flex min-w-0 flex-col gap-2">
          <h2 className={h2}>{tr({ en: 'Idling loops', ru: 'Петли на холостом ходу' }, lang)}</h2>
          <ul className="flex flex-col gap-1">
            {Object.entries(stalls)
              .filter(([, r]) => r.stalled)
              .map(([loop, r]) => (
                <li key={loop} className="min-w-0 text-[12.5px] text-ink-2">
                  <span className="font-mono text-ink-2">{loop}</span>{' '}
                  <span className="text-muted">
                    {tr(
                      {
                        en: `${r.seen} recent actions, none changed the library`,
                        ru: `${r.seen} последних действий, ни одно не изменило библиотеку`,
                      },
                      lang,
                    )}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {/* ДЕНЬ КОМПАНИИ: что она сделала сама. С включённой планкой она публикует без
          человека — значит отчёт постфактум обязателен, иначе автономия это чёрный ящик.
          Считается по журналу действий: ни снимков, ни джобы, ни вызовов модели. */}
      <section className="flex min-w-0 flex-col gap-3">
        <h2 className={h2}>{tr({ en: 'Company day', ru: 'День компании' }, lang)}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatTile
            label={tr({ en: 'Created', ru: 'Создано' }, lang)}
            value={num(today.created)}
            hint={tr({ en: `yesterday ${today.created === 0 && yesterday.created === 0 ? '0' : num(yesterday.created)}`, ru: `вчера ${num(yesterday.created)}` }, lang)}
          />
          <StatTile label={tr({ en: 'Improved', ru: 'Улучшено' }, lang)} value={num(today.improved)} hint={tr({ en: `yesterday ${num(yesterday.improved)}`, ru: `вчера ${num(yesterday.improved)}` }, lang)} />
          <StatTile label={tr({ en: 'Published by the bar', ru: 'Опубликовано по планке' }, lang)} value={num(today.published)} tone={today.published > 0 ? 'ok' : undefined} />
          <StatTile label={tr({ en: 'Held for you', ru: 'Оставлено вам' }, lang)} value={num(today.held)} />
          <StatTile label={tr({ en: 'Diverged (forks)', ru: 'Расхождений форком' }, lang)} value={num(today.forked)} />
          <StatTile label={tr({ en: 'Errors', ru: 'Ошибок' }, lang)} value={num(today.errors)} tone={today.errors > 0 ? 'warn' : undefined} />
        </div>

        {today.dryRun > 0 && (
          <p className="text-[12.5px] text-muted">
            {tr(
              { en: `${today.dryRun} decisions made in dry run — logged, not acted on.`, ru: `${today.dryRun} решений принято в сухом прогоне — записаны, но не выполнены.` },
              lang,
            )}
          </p>
        )}

        {/* ПОЧЕМУ не прошло планку — «не прошло» без причины это та же vanity-метрика. */}
        {today.holdReasons.length > 0 && (
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
              {tr({ en: 'Why lists did not pass the bar', ru: 'Почему списки не прошли планку' }, lang)}
            </div>
            <ul className="flex flex-col gap-1.5">
              {today.holdReasons.map((r) => (
                <li key={r.reason} className="flex min-w-0 items-start justify-between gap-3 text-[12.5px] text-ink-2">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{r.reason}</span>
                  <span className="shrink-0 font-mono text-muted">×{r.times}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Лента событий дня. Пусто — так и пишем: «сегодня компания ничего не делала». */}
        {today.events.length === 0 ? (
          <p className="text-[12.5px] text-muted">
            {tr({ en: 'Nothing today — the loops are off, paused or had no work.', ru: 'Сегодня ничего — петли выключены, на паузе или работы не было.' }, lang)}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[420px] text-[12.5px]">
              <tbody>
                {today.events.map((e, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-muted">
                      {new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(e.at)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-2">{e.action}</td>
                    <td className="px-3 py-2 text-ink-2 [overflow-wrap:anywhere]">{e.ref || '—'}</td>
                    <td className="hidden px-3 py-2 text-muted [overflow-wrap:anywhere] sm:table-cell">{e.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* СКОРКАРТ ПО РЕМЕСЛУ — теневой режим: считаем и объясняем, никого не наймём и не
          уволим. Две оси обязательны (одна обманывает), доверие в домен не переносится. */}
      <section className="flex min-w-0 flex-col gap-3">
        <h2 className={h2}>{tr({ en: 'Scorecard by craft (shadow)', ru: 'Скоркарт по ремеслу (теневой)' }, lang)}</h2>
        <p className="text-[12.5px] text-muted">
          {tr(
            {
              en: 'Two axes are required: acceptance and facet delivery. A craft with no direct attempts gets no score at all — not a zero, not an average. Nothing here triggers hiring or firing.',
              ru: 'Двух осей требуем нарочно: приёмка и доезжаемость граней. У ремесла без прямых попыток оценки нет вовсе — ни нуля, ни среднего. Ни одно число здесь никого не наймёт и не уволит.',
            },
            lang,
          )}
        </p>
        {cards.length === 0 ? (
          <p className="text-[12.5px] text-muted">{tr({ en: 'No data yet.', ru: 'Данных пока нет.' }, lang)}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[520px] text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="px-3 py-2 font-medium">{tr({ en: 'Specialist', ru: 'Специалист' }, lang)}</th>
                  <th className="px-3 py-2 font-medium">{tr({ en: 'Craft', ru: 'Ремесло' }, lang)}</th>
                  <th className="px-3 py-2 font-medium">{tr({ en: 'Acceptance', ru: 'Приёмка' }, lang)}</th>
                  <th className="px-3 py-2 font-medium">{tr({ en: 'Facets delivered', ru: 'Граней доехало' }, lang)}</th>
                  <th className="px-3 py-2 font-medium">{tr({ en: 'Verdict', ru: 'Вердикт' }, lang)}</th>
                </tr>
              </thead>
              <tbody>
                {cards.slice(0, 14).map((c) => (
                  <tr key={`${c.gnomeId}:${c.domain}`} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-ink-2">{c.gnomeId}</td>
                    <td className="px-3 py-2 text-ink-2 [overflow-wrap:anywhere]">{c.domain}</td>
                    <td className="px-3 py-2 font-mono text-ink-2">{c.card.acceptance == null ? '—' : pct(c.card.acceptance)}</td>
                    <td className="px-3 py-2 font-mono text-ink-2">{c.card.facetDelivery == null ? '—' : pct(c.card.facetDelivery)}</td>
                    <td className="px-3 py-2 text-muted [overflow-wrap:anywhere]">{c.card.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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

      {/* ГЛАВНЫЙ ОТКРЫТЫЙ ВОПРОС: оправдывает ли совет свою цену. Держим на виду, а не
          в разовом разборе — иначе наблюдение забывается, а решение принимается на глаз. */}
      <section className="flex min-w-0 flex-col gap-3">
        <h2 className={h2}>{tr({ en: 'Council vs single', ru: 'Совет против одиночки' }, lang)}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={tr({ en: 'Council · accepted', ru: 'Совет · принято' }, lang)}
            value={m.engines.council.gens ? pct(m.engines.council.accepted / m.engines.council.gens) : '—'}
            hint={tr(
              { en: `${m.engines.council.accepted} of ${m.engines.council.gens}`, ru: `${m.engines.council.accepted} из ${m.engines.council.gens}` },
              lang,
            )}
            tone={m.engines.council.gens && m.engines.council.accepted === 0 ? 'warn' : 'ink'}
          />
          <StatTile
            label={tr({ en: 'Single · accepted', ru: 'Одиночка · принято' }, lang)}
            value={m.engines.single.gens ? pct(m.engines.single.accepted / m.engines.single.gens) : '—'}
            hint={tr(
              { en: `${m.engines.single.accepted} of ${m.engines.single.gens}`, ru: `${m.engines.single.accepted} из ${m.engines.single.gens}` },
              lang,
            )}
          />
        </div>
        <p className="text-[12px] text-muted">
          {tr(
            {
              en: 'The council costs several model calls per list; single generation costs one. If its acceptance is not higher, the extra cost buys nothing — that is a measurement, not an opinion.',
              ru: 'Совет стоит нескольких вызовов модели на список, одиночка — одного. Если его приёмка не выше, доплата ничего не покупает — и это замер, а не мнение.',
            },
            lang,
          )}
        </p>
      </section>

      {/* ПОВЕСТКА РАЗВИТИЯ — «что растим и почему». Стоит выше метрик намеренно: метрики
          отвечают «как дела», повестка — «что делать», и это единственное место, где компания
          смотрит на себя целиком. Пункт предлагает петля, решает человек. */}
      <section id="agenda" className="flex min-w-0 flex-col gap-3">
        <h2 className={h2}>{tr({ en: 'Development agenda', ru: 'Повестка развития' }, lang)}</h2>
        {agenda.length === 0 ? (
          <p className="text-[12.5px] text-muted">
            {tr(
              { en: 'Nothing proposed yet — the partners loop runs weekly.', ru: 'Пока нечего предложить — петля партнёров работает раз в неделю.' },
              lang,
            )}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <div className={`grid min-w-[720px] ${AGENDA_COLS} gap-4 border-b border-border px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted`}>
              <span>{tr({ en: 'What to grow', ru: 'Что растим' }, lang)}</span>
              <span>{tr({ en: 'Why (numbers)', ru: 'Почему (числа)' }, lang)}</span>
              <span className="text-right">{tr({ en: 'Priority', ru: 'Приоритет' }, lang)}</span>
              <span className="text-right">{tr({ en: 'Decision', ru: 'Решение' }, lang)}</span>
            </div>
            {agenda.map((a) => (
              <div key={a.id} className={`grid min-w-[720px] ${AGENDA_COLS} items-center gap-4 border-b border-border px-4 py-2.5 last:border-0`}>
                <span className="min-w-0 truncate text-[13px] text-ink">{agendaLabel(a.kind as AgendaKind, a.domain, lang === 'ru')}</span>
                {/* Числа как есть: «списков 1 при пороге 5» проверяемо, «усилить направление» — нет. */}
                <span className="min-w-0 truncate font-mono text-[11.5px] text-ink-2">
                  {Object.entries(a.why).map(([k, v]) => `${k}=${v}`).join(' · ')}
                </span>
                <span className="text-right font-mono tabular-nums text-[12.5px] text-ink-2">{a.score.toFixed(2)}</span>
                <div className="flex items-center justify-end gap-0.5">
                  {a.status === 'proposed' ? (
                    <>
                      <form action={decideAgendaItem}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="decision" value="approved" />
                        <button type="submit" aria-label={tr({ en: 'Approve', ru: 'Одобрить' }, lang)} title={tr({ en: 'Approve', ru: 'Одобрить' }, lang)} className="grid size-11 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ok">
                          <Check size={16} />
                        </button>
                      </form>
                      <form action={decideAgendaItem}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="decision" value="dismissed" />
                        <button type="submit" aria-label={tr({ en: 'Dismiss', ru: 'Отклонить' }, lang)} title={tr({ en: 'Dismiss', ru: 'Отклонить' }, lang)} className="grid size-11 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-warn">
                          <X size={16} />
                        </button>
                      </form>
                    </>
                  ) : (
                    <span className={`text-[12px] ${a.status === 'approved' ? 'text-ok' : 'text-muted'}`}>
                      {a.status === 'approved' ? tr({ en: 'approved', ru: 'одобрено' }, lang) : tr({ en: 'dismissed', ru: 'отклонено' }, lang)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-[12px] text-muted">
          {tr(
            {
              en: 'Approved topics are what production picks first. Dismissed ones are never proposed again.',
              ru: 'Одобренные темы производство берёт первыми. Отклонённые больше не предлагаются.',
            },
            lang,
          )}
        </p>
      </section>

      {/* ЛЕНТЫ. Меряем не «сколько добавили» — это мера нашего расхода, — а читают ли, ходят ли
          по источникам и правят ли руками. Последнее сильнее всего: своё время человек тратит
          только на нужное. Блока нет, когда лент нет: пустая таблица обещала бы работу. */}
      {m.feeds.length > 0 && (
        <section className="flex min-w-0 flex-col gap-3">
          <h2 className={h2}>{tr({ en: 'Living lists', ru: 'Живые списки' }, lang)}</h2>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <div className={`grid min-w-[720px] ${FEED_COLS} gap-4 border-b border-border px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted`}>
              <span>{tr({ en: 'Feed', ru: 'Лента' }, lang)}</span>
              <span className="text-right">{tr({ en: 'Fresh', ru: 'Свежесть' }, lang)}</span>
              <span className="text-right">{tr({ en: 'Grown', ru: 'Роста' }, lang)}</span>
              <span className="text-right">{tr({ en: 'Views', ru: 'Просмотров' }, lang)}</span>
              <span className="text-right">{tr({ en: 'Source clicks', ru: 'Кликов' }, lang)}</span>
              <span className="text-right">{tr({ en: 'Human edits', ru: 'Правок людей' }, lang)}</span>
            </div>
            {m.feeds.map((f) => (
              <div key={f.id} className={`grid min-w-[720px] ${FEED_COLS} items-center gap-4 border-b border-border px-4 py-2.5 last:border-0`}>
                <Link href={`/${f.handle}/${f.slug}`} className="min-w-0 truncate text-[13px] text-ink hover:text-accent" title={f.title}>
                  {f.title}
                </Link>
                <span className={`text-right font-mono tabular-nums text-[12.5px] ${f.freshestAgeDays == null ? 'text-muted' : f.freshestAgeDays > 7 ? 'text-warn' : 'text-ok'}`}>
                  {f.freshestAgeDays == null ? '—' : tr({ en: `${f.freshestAgeDays}d`, ru: `${f.freshestAgeDays} дн.` }, lang)}
                </span>
                <span className="text-right font-mono tabular-nums text-[12.5px] text-ink-2">{num(f.grown)}</span>
                <span className="text-right font-mono tabular-nums text-[12.5px] text-ink-2">{num(f.views)}</span>
                <span className="text-right font-mono tabular-nums text-[12.5px] text-ink-2">{num(f.clicks)}</span>
                {/* Правки людей выделены: это единственная цифра здесь, которую нельзя получить,
                    потратив свои же деньги. */}
                <span className={`text-right font-mono tabular-nums text-[12.5px] ${f.humanEdits > 0 ? 'text-ok' : 'text-muted'}`}>{num(f.humanEdits)}</span>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-muted">
            {tr(
              {
                en: 'A feed is worth its cost when people read it, follow its sources and edit it by hand — not when it grows. Freshness over 7 days means the gate holds it back.',
                ru: 'Лента оправдывает расход, когда её читают, ходят по её источникам и правят руками, — а не когда она растёт. Свежесть больше 7 дней означает, что планка её не пропустит.',
              },
              lang,
            )}
          </p>
        </section>
      )}

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
            <div className="grid min-w-[520px] grid-cols-[minmax(0,1fr)_96px_104px_88px_128px] gap-4 border-b border-border px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted">
              <span>{tr({ en: 'Specialist', ru: 'Специалист' }, lang)}</span>
              <span className="text-right">{tr({ en: 'Rank', ru: 'Ранг' }, lang)}</span>
              <span className="text-right">{tr({ en: 'Councils', ru: 'Советов' }, lang)}</span>
              <span className="text-right">{tr({ en: 'Accepted', ru: 'Принято' }, lang)}</span>
              <span className="text-right">{tr({ en: 'Share', ru: 'Доля' }, lang)}</span>
            </div>
            {m.gnomes.map((g) => (
              <Link
                key={g.id}
                href={`/admin/council/${g.id}`}
                className="grid min-w-[520px] grid-cols-[minmax(0,1fr)_96px_104px_88px_128px] items-center gap-4 border-b border-border px-4 py-3 hover:bg-surface-2"
              >
                <span className="truncate text-[13px] font-medium text-ink">{lang === 'ru' ? g.nameRu : g.nameEn}</span>
                <span className="text-right text-[12px] text-muted">{lang === 'ru' ? g.rankRu : g.rankEn}</span>
                <span className="text-right font-mono tabular-nums text-[13px] text-ink-2">{num(g.gens)}</span>
                <span className="text-right font-mono tabular-nums text-[13px] text-ink-2">{num(g.accepted)}</span>
                <span className="text-right font-mono tabular-nums text-[13px] text-ink-2">{g.trusted ? pct(g.score) : '—'}</span>
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

      {/* ПЕТЛИ: рубильник, сухой прогон, предохранитель. Здесь, а не в настройках ИИ —
          это мостик, место, откуда останавливают работу, увидев неладное. */}
      <section className="flex min-w-0 flex-col gap-3">
        <h2 className={h2}>{tr({ en: 'Autonomous loops', ru: 'Автономные петли' }, lang)}</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <div className="grid min-w-[560px] grid-cols-[minmax(0,1fr)_112px_112px_112px] gap-4 border-b border-border px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted">
            <span>{tr({ en: 'Loop', ru: 'Петля' }, lang)}</span>
            <span className="text-right">{tr({ en: 'State', ru: 'Состояние' }, lang)}</span>
            <span className="text-right">{tr({ en: 'Dry run', ru: 'Сухой прогон' }, lang)}</span>
            <span className="text-right">{tr({ en: 'Switch', ru: 'Рубильник' }, lang)}</span>
          </div>
          {loops.map((l) => (
            <div key={l.type} className="grid min-w-[560px] grid-cols-[minmax(0,1fr)_112px_112px_112px] items-center gap-4 border-b border-border px-4 py-3 last:border-0">
              <span className="truncate font-mono text-[12.5px] text-ink">{l.type}</span>
              <span className={`text-right text-[12px] ${l.circuitTripped ? 'text-danger' : l.paused ? 'text-warn' : 'text-ok'}`}>
                {l.circuitTripped
                  ? tr({ en: 'breaker tripped', ru: 'предохранитель' }, lang)
                  : l.paused
                    ? tr({ en: 'paused', ru: 'остановлена' }, lang)
                    : tr({ en: 'running', ru: 'работает' }, lang)}
              </span>
              <form action={toggleLoopDryRun} className="text-right">
                <input type="hidden" name="type" value={l.type} />
                <input type="hidden" name="dryRun" value={String(l.dryRun)} />
                <button type="submit" className="inline-flex h-[38px] items-center rounded-md border border-border px-3 text-[12px] text-ink-2 hover:text-ink">
                  {l.dryRun ? tr({ en: 'on', ru: 'вкл' }, lang) : tr({ en: 'off', ru: 'выкл' }, lang)}
                </button>
              </form>
              <div className="flex justify-end gap-2">
                {l.circuitTripped && (
                  <form action={resetLoopCircuit}>
                    <input type="hidden" name="type" value={l.type} />
                    <button type="submit" className="inline-flex h-[38px] items-center rounded-md border border-danger/40 px-3 text-[12px] text-danger">
                      {tr({ en: 'Reset', ru: 'Сбросить' }, lang)}
                    </button>
                  </form>
                )}
                <form action={toggleLoopPause}>
                  <input type="hidden" name="type" value={l.type} />
                  <input type="hidden" name="paused" value={String(l.paused)} />
                  <button
                    type="submit"
                    className="inline-flex h-[38px] items-center gap-1.5 rounded-md border border-border px-3 text-[12px] text-ink hover:border-border-strong"
                  >
                    {l.paused ? <Play size={13} /> : <Pause size={13} />}
                    {l.paused ? tr({ en: 'Resume', ru: 'Пустить' }, lang) : tr({ en: 'Pause', ru: 'Стоп' }, lang)}
                  </button>
                </form>
              </div>
            </div>
          ))}
          <div className="px-4 py-2.5 text-[11.5px] text-muted">
            {tr(
              {
                en: 'Pause stops the queue from handing out this loop’s jobs — atomically, on every instance, without a restart. The breaker is tripped by code and cleared by a human.',
                ru: 'Стоп прекращает выдачу задач этой петли — атомарно, на всех инстансах, без рестарта. Предохранитель ставит код, снимает человек.',
              },
              lang,
            )}
          </div>
        </div>
      </section>

      <p className="text-[12px] text-muted">
        {tr(
          {
            en: 'Metrics are read-only aggregates and never call a model. «—» means the source does not exist yet, not zero. The loop switches above do write.',
            ru: 'Метрики только читают и не зовут модель. «—» значит источника ещё нет, а не ноль. Рубильники петель выше — пишут.',
          },
          lang,
        )}
      </p>
    </div>
  )
}
