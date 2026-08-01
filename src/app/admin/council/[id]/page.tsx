import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, BookOpen, CheckCircle2, CircleUser, Gauge, Users } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { getRosterAll, rosterAvatars } from '@/shared/ai/roster'
import { prettyModelName } from '@/shared/ai/models'
import { gnomeKpi } from '@/features/admin/gnome-stats'
import { gnomeMood, gnomeThanksCounts } from '@/shared/ai/gnome-reputation'
import { timeAgo } from '@/shared/ui/timeAgo'
import { ExpertSettings } from '@/features/admin/ExpertSettings'
import { GnomeAvatar } from '@/shared/ui/GnomeAvatar'
import { Tooltip } from '@/shared/ui/Tooltip'

/**
 * СТРАНИЦА СПЕЦИАЛИСТА (админу): его развитие И его настройки — в одном месте.
 *
 * Было: настройки всех двадцати жили одной стеной форм в зале совета, а здесь их можно было
 * только смотреть со ссылкой «править там». Теперь как у списка: у списка настройки на
 * странице списка, у специалиста — на его странице. Зал совета показывает СОСТАВ.
 *
 * «Через их аккаунты»: у специалиста есть аккаунт уровня пользователя (ADR-0004), поэтому
 * отсюда ведёт ссылка на его публичный профиль — то, что видят люди.
 */
export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('expertTitle', lang) }
}

export default async function GnomePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const [{ id }, lang] = await Promise.all([params, getLang()])
  const ru = lang === 'ru'
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)

  const [roster, avatars] = await Promise.all([getRosterAll(), rosterAvatars()])
  const e = roster.find((x) => x.id === id)
  if (!e) notFound()
  const kpi = await gnomeKpi(e.id, e.domains, e.model)
  // Настройки этого специалиста живут ЗДЕСЬ: каталог моделей и галерея аватаров нужны форме.
  const [{ agentHandles }, { fetchModels }, { getApiKey }] = await Promise.all([
    import('@/shared/ai/gnome-account'),
    import('@/shared/ai/models'),
    import('@/shared/settings/ai'),
  ])
  const handle = e.userId ? (await agentHandles([e.userId]))[e.userId] : null
  const apiKey = await getApiKey()
  const models = apiKey ? await fetchModels() : null
  const modelOptions = [...(models?.chat ?? [])]
    .sort((a, b) => (a.completionPrice || a.promptPrice) - (b.completionPrice || b.promptPrice))
    .map((m) => ({ value: m.id, id: m.id, label: m.label, family: m.family }))
  const { builtinAvatars } = await import('@/shared/ai/avatar-gallery')
  const gallery = await builtinAvatars()

  const name = ru ? e.nameRu : e.nameEn
  // Карта уже отрезолвлена по реальным файлам (rosterAvatars); пусто → заглушка GnomeAvatar.
  const avatarUrl = avatars[e.id]
  const acceptShare = kpi.gens ? Math.round((kpi.accepted / kpi.gens) * 100) : null
  // Настроение (RPG-развитие): демеанор из послужного списка — в стиль общения.
  const thanksN = (await gnomeThanksCounts())[e.id] ?? 0
  const mood = gnomeMood({ [e.id]: { gens: kpi.gens, accepted: kpi.accepted } }, e.id, thanksN)
  const moodEmoji: Record<string, string> = { elated: '😄', content: '🙂', settled: '😐', wary: '😟', grumpy: '😾' }

  const card = 'rounded-lg border border-border bg-surface p-4'
  const kpiCell = (icon: ReactNode, label: string, value: string, sub?: string) => (
    <div className={card}>
      <div className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
        {icon} {label}
      </div>
      <div className="mt-1.5 text-[1.375rem] font-bold text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-[0.78125rem] text-ink-2">{sub}</div>}
    </div>
  )

  return (
    <div className="flex w-full min-w-0 flex-col px-5 py-6 md:px-8">
      <Link href="/admin/council" className="mb-4 inline-flex items-center gap-2 text-[0.8125rem] text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> {say('Council hall', 'Зал совета')}
      </Link>

      <div className="mb-5 flex items-center gap-4">
        {/* Аватар из ростера: загруженный URL или встроенный webp; пусто → заглушка без 404. */}
        <GnomeAvatar src={avatarUrl} size={64} className="size-16 rounded-full border border-border object-cover" />
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-[1.25rem] font-bold text-ink">
            {name}
            {!e.enabled && (
              <span className="rounded-md border border-border px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted">{say('disabled', 'выключен')}</span>
            )}
          </h1>
          {(ru ? e.guildRu : e.guildEn) && <div className="mt-0.5 text-[0.8125rem] font-medium text-accent">{ru ? e.guildRu : e.guildEn}</div>}
          {/* Аккаунт специалиста — то, что видят люди: списки, комментарии, авторство. */}
          {handle ? (
            <Link href={`/${handle}`} className="mt-0.5 inline-flex items-center gap-1 text-[0.78125rem] text-ink-2 hover:text-accent">
              <CircleUser size={12} /> @{handle}
            </Link>
          ) : (
            <div className="mt-0.5 inline-flex items-center gap-1 text-[0.78125rem] text-warn">
              <CircleUser size={12} /> {say('no account yet — create it in the council hall', 'аккаунта пока нет — заводится в зале совета')}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {/* Настроение гнома (RPG): вытекает из принятости, окрашивает его реплики. */}
            <Tooltip label={mood.style || say('not enough data yet', 'пока мало данных')}>
              <span className="inline-flex items-center gap-1 rounded-full bg-(--surface-2) px-2 py-0.5 text-[0.6875rem] text-ink-2">
                {moodEmoji[mood.label] ?? '😐'} {ru ? mood.labelRu : mood.label}
              </span>
            </Tooltip>
            {e.domains.map((d) => (
              <span key={d} className="rounded-full border border-border px-2 py-0.5 text-[0.6875rem] text-ink-2">
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
          <div className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">{say('Persona (working frame)', 'Персона (рабочий каркас)')}</div>
          <p className="whitespace-pre-wrap text-[0.8125rem] leading-[1.55] text-ink-2">{e.persona}</p>
          {e.code && (
            <>
              <div className="mb-2 mt-4 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">{say('Guild code', 'Кодекс гильдии')}</div>
              {/* Людям — на их языке; агентам всегда едет EN `code`. */}
              <p className="whitespace-pre-wrap font-mono text-[0.78125rem] leading-[1.55] text-ink-2">{(ru ? e.codeRu : '') || e.code}</p>
            </>
          )}
          {e.memory && (
            <>
              <div className="mb-2 mt-4 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">{say('Craft memory (auto-distilled)', 'Память ремесла (автовыжимка)')}</div>
              <p className="whitespace-pre-wrap text-[0.78125rem] leading-[1.55] text-ink-2">{e.memory}</p>
            </>
          )}

        </div>
        <div className={card}>
          <div className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">{say('Recent councils', 'Последние советы')}</div>
          {kpi.recent.length === 0 ? (
            <p className="text-[0.8125rem] text-muted">{say('Has not been summoned yet.', 'Ещё ни разу не созывался.')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {kpi.recent.map((r, i) => (
                <li key={i} className="flex items-baseline gap-2 text-[0.8125rem]">
                  <span className={`shrink-0 ${r.accepted ? 'text-ok' : 'text-muted'}`}>{r.accepted ? '✓' : '·'}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{r.query}</span>
                  <span className="shrink-0 whitespace-nowrap text-[0.6875rem] text-muted">{timeAgo(r.createdAt, lang)}</span>
                </li>
              ))}
            </ul>
          )}
          {kpi.lastSeenAt && (
            <div className="mt-2 text-[0.6875rem] text-muted">
              {say('Last draft:', 'Последний черновик:')} {timeAgo(kpi.lastSeenAt, lang)}
            </div>
          )}
        </div>
      </div>

      {/* НАСТРОЙКИ — здесь, а не в общем зале: у списка настройки на странице списка, у
          специалиста на его странице. Одна форма на одного, а не стена из двадцати. */}
      <div className="mt-5">
        <div className="mb-2 text-[0.8125rem] font-semibold uppercase tracking-wide text-ink-2">{say('Settings', 'Настройки')}</div>
        <ExpertSettings e={{ ...e, uploadedUrl: e.avatarUploaded ? avatars[e.id] : undefined }} modelOptions={modelOptions} gallery={gallery} ru={ru} />
      </div>
    </div>
  )
}
