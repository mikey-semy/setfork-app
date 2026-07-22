import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, BookOpen, CheckCircle2, Gauge, Users } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { getRosterAll, rosterAvatars } from '@/shared/ai/roster'
import { prettyModelName } from '@/shared/ai/models'
import { gnomeKpi } from '@/features/admin/gnome-stats'
import { timeAgo } from '@/shared/ui/timeAgo'

/**
 * Личная страница гнома (пока только админу) — этап (б) профразвития: KPI,
 * база знаний и текущие настройки в одном месте. Правки — в зале совета
 * (/admin/council): здесь смотрим на развитие, там крутим ручки.
 */
export const metadata = { title: 'Gnome' }

export default async function GnomePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const [{ id }, lang] = await Promise.all([params, getLang()])
  const ru = lang === 'ru'
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)

  const [roster, avatars] = await Promise.all([getRosterAll(), rosterAvatars()])
  const e = roster.find((x) => x.id === id)
  if (!e) notFound()
  const kpi = await gnomeKpi(e.id, e.domains, e.model)

  const name = ru ? e.nameRu : e.nameEn
  const avatarUrl = e.avatarUploaded ? avatars[e.id] : `/gnomes/${e.avatar || e.id}.webp`
  const acceptShare = kpi.gens ? Math.round((kpi.accepted / kpi.gens) * 100) : null

  const card = 'rounded-lg border border-border bg-surface p-4'
  const kpiCell = (icon: ReactNode, label: string, value: string, sub?: string) => (
    <div className={card}>
      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
        {icon} {label}
      </div>
      <div className="mt-1.5 text-[22px] font-bold text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-ink-2">{sub}</div>}
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 py-6 sm:px-6">
      <Link href="/admin/council" className="mb-4 inline-flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> {say('Council hall', 'Зал совета')}
      </Link>

      <div className="mb-5 flex items-center gap-4">
        {/* Аватар из ростера: загруженный URL или встроенный webp. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- локальная статика/imgproxy, размеры фиксированы */}
        <img src={avatarUrl} alt="" width={64} height={64} className="size-16 rounded-full border border-border object-cover" />
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-[20px] font-bold text-ink">
            {name}
            {!e.enabled && (
              <span className="rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted">{say('disabled', 'выключен')}</span>
            )}
          </h1>
          {(ru ? e.guildRu : e.guildEn) && <div className="mt-0.5 text-[13px] font-medium text-accent">{ru ? e.guildRu : e.guildEn}</div>}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {e.domains.map((d) => (
              <span key={d} className="rounded-full border border-border px-2 py-0.5 text-[11.5px] text-ink-2">
                {d}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpiCell(
          <Users size={13} />,
          say('Council rounds', 'Витки совета'),
          String(kpi.rounds30d),
          say(`30 days · ${kpi.roundsTotal} total`, `за 30 дней · всего ${kpi.roundsTotal}`),
        )}
        {kpiCell(
          <CheckCircle2 size={13} />,
          say('Lists accepted', 'Принятые списки'),
          acceptShare === null ? '—' : `${kpi.accepted} (${acceptShare}%)`,
          say(`of ${kpi.gens} generations with him`, `из ${kpi.gens} генераций с его участием`),
        )}
        {kpiCell(
          <BookOpen size={13} />,
          say('Knowledge base', 'База знаний'),
          String(kpi.knowledge),
          say('public lists in his domains', 'публичных списков его доменов'),
        )}
        {kpiCell(
          <Gauge size={13} />,
          say('Personal model', 'Личная модель'),
          kpi.model ? `${Math.round(kpi.model.okRate * 100)}%` : '—',
          e.model
            ? kpi.model
              ? say(`${prettyModelName(e.model)} · ${kpi.model.calls} calls 7d · ~${(kpi.model.avgMs / 1000).toFixed(1)}s`, `${prettyModelName(e.model)} · ${kpi.model.calls} вызовов за 7д · ~${(kpi.model.avgMs / 1000).toFixed(1)}с`)
              : say(`${prettyModelName(e.model)} — no calls in 7d`, `${prettyModelName(e.model)} — вызовов за 7д нет`)
            : say('uses the council pool', 'работает из пула совета'),
        )}
      </div>

      <div className="mb-5 grid gap-3 lg:grid-cols-2">
        <div className={card}>
          <div className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{say('Persona (working frame)', 'Персона (рабочий каркас)')}</div>
          <p className="whitespace-pre-wrap text-[13px] leading-[1.55] text-ink-2">{e.persona}</p>
          {e.code && (
            <>
              <div className="mb-2 mt-4 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{say('Guild code', 'Кодекс гильдии')}</div>
              <p className="whitespace-pre-wrap font-mono text-[12px] leading-[1.55] text-ink-2">{e.code}</p>
            </>
          )}
          {e.memory && (
            <>
              <div className="mb-2 mt-4 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{say('Craft memory (auto-distilled)', 'Память ремесла (автовыжимка)')}</div>
              <p className="whitespace-pre-wrap text-[12.5px] leading-[1.55] text-ink-2">{e.memory}</p>
            </>
          )}
          <Link href="/admin/council" className="mt-3 inline-block text-[12.5px] font-semibold text-accent hover:underline">
            {say('Edit in the council hall →', 'Править в зале совета →')}
          </Link>
        </div>
        <div className={card}>
          <div className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{say('Recent councils', 'Последние советы')}</div>
          {kpi.recent.length === 0 ? (
            <p className="text-[13px] text-muted">{say('Has not been summoned yet.', 'Ещё ни разу не созывался.')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {kpi.recent.map((r, i) => (
                <li key={i} className="flex items-baseline gap-2 text-[13px]">
                  <span className={`shrink-0 ${r.accepted ? 'text-ok' : 'text-muted'}`}>{r.accepted ? '✓' : '·'}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{r.query}</span>
                  <span className="shrink-0 whitespace-nowrap text-[11.5px] text-muted">{timeAgo(r.createdAt, lang)}</span>
                </li>
              ))}
            </ul>
          )}
          {kpi.lastSeenAt && (
            <div className="mt-2 text-[11.5px] text-muted">
              {say('Last draft:', 'Последний черновик:')} {timeAgo(kpi.lastSeenAt, lang)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
