import Link from 'next/link'
import { TrendingUp } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t, tr, type Lang } from '@/shared/i18n'
import { getCompanyDay, getDevelopmentMetrics, UNAVAILABLE, type NaReason } from '@/features/admin/development-queries'
import { currentAgenda } from '@/features/partners/service'
import { agendaLabel, type AgendaKind } from '@/shared/agents/agenda'
import { getDomainScorecards } from '@/features/admin/scorecard-queries'
import { DevAgendaTable } from '@/features/admin/DevAgendaTable'
import { DevFeedsTable } from '@/features/admin/DevFeedsTable'
import { DevLoopsTable } from '@/features/admin/DevLoopsTable'
import { PageHeader } from '@/shared/ui/PageHeader'
import { StatTile } from '@/shared/ui/StatTile'
import { TagChip } from '@/shared/ui/TagChip'
import { AUTONOMOUS_LOOPS, allLoopPolicies } from '@/shared/agents/policy'
import { stallReports } from '@/shared/agents/stall'

/**
 * Дашборд РАЗВИТИЯ (Ф-D0) — компания гномов, видимая сверху: куда движемся, а не
 * «что сейчас» (это /admin/dashboard). Страница детерминированная: только SELECT,
 * ни одного вызова модели — открытие не стоит денег.
 *
 * Где источника нет — честное «—» с причиной (ADR-0005), а не ноль и не оценка.
 */

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('adminDevelopment', lang) }
}
export const dynamic = 'force-dynamic' // накопленные числа, без ISR-кэша

const num = (n: number) => new Intl.NumberFormat('en').format(n)
const usd = (n: number) => '$' + n.toFixed(2)
const pct = (v: number) => Math.round(v * 100) + '%'

/** Почему метрика пуста — человеческим языком, с указанием, что её откроет. */
function naText(reason: NaReason, lang: Lang): string {
  if (reason === 'no-payments-table')
    return t('admin.noSourceNoPayments', lang)
  if (reason === 'no-created-at')
    return t('admin.noSourceRosterHas', lang)
  return t('admin.noSourceDomainsNot', lang)
}

const h2 = 'text-[0.8125rem] font-semibold uppercase tracking-wide text-ink-2'

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
      <PageHeader
        icon={<TrendingUp size={17} />}
        title={t('admin.development', lang)}
        subtitle={tr(
          {
            en: 'Where we are heading: library, quality, spend, corpus, staff. Accumulated — not live monitoring.',
            ru: 'Куда движемся: библиотека, качество, расход, корпус, штат. Накопленное — не живой мониторинг.',
          },
          lang,
        )}
        actions={
          <Link href="/admin/dashboard" className="-mr-2 inline-flex items-center px-2 py-2.5 text-[0.8125rem] text-accent hover:underline">
            {t('admin.liveMonitoring', lang)}
          </Link>
        }
      />

      {/* ХОЛОСТОЙ ХОД: петля работает, деньги идут, а библиотека не меняется. «Улучшать
          нечего» — законный режим (он ведёт к расхождению форком), поэтому это не тревога
          предохранителя, а строка отчёта: узнать надо раньше, чем из счёта за модель. */}
      {Object.entries(stalls).some(([, r]) => r.stalled) && (
        <section className="flex min-w-0 flex-col gap-2">
          <h2 className={h2}>{t('admin.idlingLoops', lang)}</h2>
          <ul className="flex flex-col gap-1">
            {Object.entries(stalls)
              .filter(([, r]) => r.stalled)
              .map(([loop, r]) => (
                <li key={loop} className="min-w-0 text-[0.78125rem] text-ink-2">
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
        <h2 className={h2}>{t('admin.companyDay', lang)}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatTile
            label={t('admin.created', lang)}
            value={num(today.created)}
            hint={tr({ en: `yesterday ${today.created === 0 && yesterday.created === 0 ? '0' : num(yesterday.created)}`, ru: `вчера ${num(yesterday.created)}` }, lang)}
          />
          <StatTile label={t('admin.improved', lang)} value={num(today.improved)} hint={tr({ en: `yesterday ${num(yesterday.improved)}`, ru: `вчера ${num(yesterday.improved)}` }, lang)} />
          <StatTile label={t('admin.publishedByBar', lang)} value={num(today.published)} tone={today.published > 0 ? 'ok' : undefined} />
          <StatTile label={t('admin.heldYou', lang)} value={num(today.held)} />
          <StatTile label={t('admin.divergedForks', lang)} value={num(today.forked)} />
          <StatTile label={t('admin.errors', lang)} value={num(today.errors)} tone={today.errors > 0 ? 'warn' : undefined} />
        </div>

        {today.dryRun > 0 && (
          <p className="text-[0.78125rem] text-muted">
            {tr(
              { en: `${today.dryRun} decisions made in dry run — logged, not acted on.`, ru: `${today.dryRun} решений принято в сухом прогоне — записаны, но не выполнены.` },
              lang,
            )}
          </p>
        )}

        {/* ПОЧЕМУ не прошло планку — «не прошло» без причины это та же vanity-метрика. */}
        {today.holdReasons.length > 0 && (
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
              {t('admin.whyListsDidNot', lang)}
            </div>
            <ul className="flex flex-col gap-1.5">
              {today.holdReasons.map((r) => (
                <li key={r.reason} className="flex min-w-0 items-start justify-between gap-3 text-[0.78125rem] text-ink-2">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{r.reason}</span>
                  <span className="shrink-0 font-mono text-muted">×{r.times}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Лента событий дня. Пусто — так и пишем: «сегодня компания ничего не делала». */}
        {today.events.length === 0 ? (
          <p className="text-[0.78125rem] text-muted">
            {t('admin.nothingTodayLoopsOff', lang)}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[26.25rem] text-[0.78125rem]">
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
        <h2 className={h2}>{t('admin.scorecardByCraftShadow', lang)}</h2>
        <p className="text-[0.78125rem] text-muted">
          {tr(
            {
              en: 'Two axes are required: acceptance and facet delivery. A craft with no direct attempts gets no score at all — not a zero, not an average. Nothing here triggers hiring or firing.',
              ru: 'Двух осей требуем нарочно: приёмка и доезжаемость граней. У ремесла без прямых попыток оценки нет вовсе — ни нуля, ни среднего. Ни одно число здесь никого не наймёт и не уволит.',
            },
            lang,
          )}
        </p>
        {cards.length === 0 ? (
          <p className="text-[0.78125rem] text-muted">{t('admin.noDataYet', lang)}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[32.5rem] text-[0.78125rem]">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="px-3 py-2 font-medium">{t('admin.specialist', lang)}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.craft', lang)}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.acceptance', lang)}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.facetsDelivered', lang)}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.verdict', lang)}</th>
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
        <h2 className={h2}>{t('admin.library', lang)}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label={t('admin.publicLists', lang)} value={num(m.library.published)} />
          <StatTile label={t('admin.new', lang)} value={num(m.library.newInPeriod)} hint={period} tone="ok" />
          <StatTile label={t('admin.forks', lang)} value={num(m.library.forks)} />
          <StatTile label={t('admin.drafts', lang)} value={num(m.library.drafts)} />
        </div>
      </section>

      {/* Качество: польза для людей + вклад садовника */}
      <section className="flex min-w-0 flex-col gap-3">
        <h2 className={h2}>{t('admin.quality', lang)}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label={t('admin.stars', lang)} value={num(m.quality.stars)} />
          <StatTile label={t('admin.runs', lang)} value={num(m.quality.runs)} />
          <StatTile
            label={t('admin.improved', lang)}
            value={num(m.quality.gardenerAccepted)}
            hint={t('admin.editsAccepted', lang)}
            tone={m.quality.gardenerAccepted > 0 ? 'ok' : 'ink'}
          />
          <StatTile
            label={t('admin.awaitingReview', lang)}
            value={num(m.quality.gardenerOpen)}
            hint={tr({ en: `on ${m.quality.listsImproved} lists`, ru: `на ${m.quality.listsImproved} списках` }, lang)}
            tone={m.quality.gardenerOpen > 0 ? 'warn' : 'ink'}
            href="/admin/moderation"
          />
        </div>
      </section>

      {/* Деньги: только расход — выручки в схеме нет */}
      <section className="flex min-w-0 flex-col gap-3">
        <h2 className={h2}>{t('admin.money', lang)}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={t('admin.burnToday', lang)}
            value={usd(m.money.burnToday)}
            hint={m.money.dailyCap > 0 ? tr({ en: `cap ${usd(m.money.dailyCap)}`, ru: `кап ${usd(m.money.dailyCap)}` }, lang) : t('admin.noCap', lang)}
            tone={m.money.dailyCap > 0 && m.money.burnToday >= m.money.dailyCap * 0.8 ? 'warn' : 'ink'}
          />
          <StatTile label={t('admin.burn', lang)} value={usd(m.money.burnPeriod)} hint={period} />
          {m.money.balance == null ? (
            <StatTile label={t('admin.balance', lang)} na={t('admin.providerEndpointUnavailable', lang)} />
          ) : (
            <StatTile label={t('admin.balance', lang)} value={usd(m.money.balance)} href="/admin/usage" />
          )}
          <StatTile label={t('admin.margin', lang)} na={naText(UNAVAILABLE.margin, lang)} />
        </div>
        {m.money.runwayGens != null && (
          <p className="text-[0.78125rem] text-muted">
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
        <h2 className={h2}>{t('admin.councilVsSingle', lang)}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={t('admin.councilAccepted', lang)}
            value={m.engines.council.gens ? pct(m.engines.council.accepted / m.engines.council.gens) : '—'}
            hint={tr(
              { en: `${m.engines.council.accepted} of ${m.engines.council.gens}`, ru: `${m.engines.council.accepted} из ${m.engines.council.gens}` },
              lang,
            )}
            tone={m.engines.council.gens && m.engines.council.accepted === 0 ? 'warn' : 'ink'}
          />
          <StatTile
            label={t('admin.singleAccepted', lang)}
            value={m.engines.single.gens ? pct(m.engines.single.accepted / m.engines.single.gens) : '—'}
            hint={tr(
              { en: `${m.engines.single.accepted} of ${m.engines.single.gens}`, ru: `${m.engines.single.accepted} из ${m.engines.single.gens}` },
              lang,
            )}
          />
        </div>
        <p className="text-[0.78125rem] text-muted">
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
        <h2 className={h2}>{t('admin.developmentAgenda', lang)}</h2>
        {agenda.length === 0 ? (
          <p className="text-[0.78125rem] text-muted">
            {tr(
              { en: 'Nothing proposed yet — the partners loop runs weekly.', ru: 'Пока нечего предложить — петля партнёров работает раз в неделю.' },
              lang,
            )}
          </p>
        ) : (
          <DevAgendaTable
            lang={lang}
            rows={agenda.map((a) => ({
              id: a.id,
              label: agendaLabel(a.kind as AgendaKind, a.domain, lang === 'ru'),
              why: Object.entries(a.why).map(([k, v]) => `${k}=${v}`).join(' · '),
              score: a.score,
              status: a.status,
              ownerExpertId: a.ownerExpertId,
            }))}
          />
        )}
        <p className="text-[0.78125rem] text-muted">
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
          <h2 className={h2}>{t('admin.livingLists', lang)}</h2>
          <DevFeedsTable
            lang={lang}
            rows={m.feeds.map((f) => ({
              id: f.id,
              href: `/${f.handle}/${f.slug}`,
              title: f.title,
              freshestAgeDays: f.freshestAgeDays,
              grown: f.grown,
              views: f.views,
              clicks: f.clicks,
              humanEdits: f.humanEdits,
            }))}
          />
          <p className="text-[0.78125rem] text-muted">
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
        <h2 className={h2}>{t('admin.knowledgeCorpus', lang)}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label={t('admin.facts', lang)} value={num(m.corpus.triples)} hint={t('admin.kAGTriples', lang)} />
          <StatTile label={t('admin.newFacts', lang)} value={num(m.corpus.triplesNewInPeriod)} hint={period} tone="ok" />
          <StatTile
            label={t('admin.listsMined', lang)}
            value={num(m.corpus.listsMined)}
            hint={tr({ en: `of ${m.library.published} public`, ru: `из ${m.library.published} публичных` }, lang)}
          />
          <StatTile label={t('admin.domainCoverage', lang)} na={naText(UNAVAILABLE.domainCoverage, lang)} />
        </div>
      </section>

      {/* Штат */}
      <section className="flex min-w-0 flex-col gap-3">
        <h2 className={h2}>{t('admin.staff', lang)}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={t('admin.active', lang)}
            value={num(m.roster.enabled)}
            hint={tr({ en: `of ${m.roster.total} in roster`, ru: `из ${m.roster.total} в ростере` }, lang)}
            href="/admin/council"
          />
          <StatTile label={t('admin.newProfessions', lang)} na={naText(UNAVAILABLE.newProfessions, lang)} />
          <StatTile label={t('admin.growthTopics', lang)} value={num(m.topics.length)} hint={t('admin.rawSignal', lang)} tone={m.topics.length > 0 ? 'accent' : 'ink'} />
        </div>

        {/* Участие в совете — таблица столбцами (как щиток надёжности моделей).
            Скроллится КОНТЕЙНЕР (overflow-x-auto + min-w), страница — никогда.
            Долю НЕ красим: это участие, а не победы (атрибуция общая, см. development-queries). */}
        {m.gnomes.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-4 py-2.5">
              <span className="text-[0.8125rem] font-semibold text-ink">{t('admin.councilParticipation', lang)}</span>
              <span className="ml-2 text-[0.78125rem] text-muted">
                {tr(
                  {
                    en: 'acceptance counts for every drafter — participation, not a win rate',
                    ru: 'принятие засчитывается всем, кто дал черновик, — участие, а не победы',
                  },
                  lang,
                )}
              </span>
            </div>
            <div className="grid min-w-[32.5rem] grid-cols-[minmax(0,1fr)_96px_104px_88px_128px] gap-4 border-b border-border px-4 py-2.5 text-[0.6875rem] uppercase tracking-wide text-muted">
              <span>{t('admin.specialist', lang)}</span>
              <span className="text-right">{t('admin.rank', lang)}</span>
              <span className="text-right">{t('admin.councils', lang)}</span>
              <span className="text-right">{t('admin.accepted', lang)}</span>
              <span className="text-right">{t('admin.share', lang)}</span>
            </div>
            {m.gnomes.map((g) => (
              <Link
                key={g.id}
                href={`/admin/council/${g.id}`}
                className="grid min-w-[32.5rem] grid-cols-[minmax(0,1fr)_96px_104px_88px_128px] items-center gap-4 border-b border-border px-4 py-3 hover:bg-surface-2"
              >
                <span className="truncate text-[0.8125rem] font-medium text-ink">{lang === 'ru' ? g.nameRu : g.nameEn}</span>
                <span className="text-right text-[0.78125rem] text-muted">{lang === 'ru' ? g.rankRu : g.rankEn}</span>
                <span className="text-right font-mono tabular-nums text-[0.8125rem] text-ink-2">{num(g.gens)}</span>
                <span className="text-right font-mono tabular-nums text-[0.8125rem] text-ink-2">{num(g.accepted)}</span>
                <span className="text-right font-mono tabular-nums text-[0.8125rem] text-ink-2">{g.trusted ? pct(g.score) : '—'}</span>
              </Link>
            ))}
            <div className="px-4 py-2.5 text-[0.6875rem] text-muted">
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
              <span className="text-[0.8125rem] font-semibold text-ink">{t('admin.uncoveredTopics', lang)}</span>
              <span className="ml-2 text-[0.78125rem] text-muted">
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
            <div className="px-4 pb-3 text-[0.6875rem] text-muted">
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
        <h2 className={h2}>{t('admin.autonomousLoops', lang)}</h2>
        <DevLoopsTable
          lang={lang}
          rows={loops.map((l) => ({ type: l.type, paused: l.paused, dryRun: l.dryRun, circuitTripped: l.circuitTripped }))}
        />
      </section>

      <p className="text-[0.78125rem] text-muted">
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
