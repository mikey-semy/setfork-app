import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, BookOpen, CheckCircle2, CircleUser, Cpu, Gauge, Users } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { getRosterAll, rosterAvatars } from '@/shared/ai/roster'
import { prettyModelName } from '@/shared/ai/models'
import { baseModelId } from '@/shared/ai/health'
import { gnomeKpi } from '@/features/admin/gnome-stats'
import { gnomeMood, gnomeThanksCounts } from '@/shared/ai/gnome-reputation'
import { timeAgo } from '@/shared/ui/timeAgo'
import { ExpertSettings } from '@/features/admin/ExpertSettings'

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
  // Тот же построитель опций, что и в общей админке: цены, наш рейтинг, занятость. Здесь
  // раньше был третий, обеднённый вариант списка — без цен и без опыта, то есть выбор вслепую.
  const { buildOpts } = await import('@/features/admin/model-options')
  const { modelMeta } = await import('@/features/admin/model-enrich')
  const meta = await modelMeta(models?.currency ?? 'USD', ru)
  const modelOptions = models ? buildOpts(models.chat, false, lang, models.currency, models.pricesKnown, meta) : []
  // Чем думает ЭТОТ специалист: его модель, наш опыт с ней и кто ещё на ней сидит.
  const myMeta = e.model ? meta.get(baseModelId(e.model)) : undefined
  const alsoOnModel = (myMeta?.holders ?? []).filter((h) => h.gnomeId !== e.id)
  const { builtinAvatars } = await import('@/features/admin/avatar-gallery')
  const gallery = await builtinAvatars()

  const name = ru ? e.nameRu : e.nameEn
  const avatarUrl = e.avatarUploaded ? avatars[e.id] : `/gnomes/${e.avatar || e.id}.webp`
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
        {/* Аватар из ростера: загруженный URL или встроенный webp. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- локальная статика/imgproxy, размеры фиксированы */}
        <img src={avatarUrl} alt="" width={64} height={64} className="size-16 rounded-full border border-border object-cover" />
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
            <span className="inline-flex items-center gap-1 rounded-full bg-(--surface-2) px-2 py-0.5 text-[0.6875rem] text-ink-2" title={mood.style || say('not enough data yet', 'пока мало данных')}>
              {moodEmoji[mood.label] ?? '😐'} {ru ? mood.labelRu : mood.label}
            </span>
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
              <p className="whitespace-pre-wrap font-mono text-[0.78125rem] leading-[1.55] text-ink-2">{e.code}</p>
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

      {/* ЧЕМ ДУМАЕТ — рядом с формой, где эту модель и меняют. Без блока «модель» была просто
          строкой в селекте: непонятно, что она делает, чего стоит и что будет, если оставить пусто. */}
      <div className={`${card} mb-5`}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">{say('Thinks with', 'Чем думает')}</span>
          <Link href="/admin/models" className="ml-auto inline-flex min-h-11 items-center gap-1 text-[0.78125rem] text-ink-2 hover:text-accent">
            <Cpu size={13} /> {say('All models', 'Все модели')}
          </Link>
        </div>
        {e.model ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-[1rem] font-semibold text-ink">{prettyModelName(e.model)}</span>
              {myMeta?.okPct != null && (
                <span className={`tabular-nums text-[0.78125rem] ${myMeta.quarantined ? 'text-danger' : 'text-ok'}`}>
                  {myMeta.okPct}% · {myMeta.calls}
                </span>
              )}
              {myMeta?.ourCost && <span className="tabular-nums text-[0.78125rem] text-muted">{say(`${myMeta.ourCost} / call`, `${myMeta.ourCost} за вызов`)}</span>}
              {myMeta?.p95 && <span className="tabular-nums text-[0.78125rem] text-muted">p95 {myMeta.p95}</span>}
            </div>
            <p className="mt-1.5 text-[0.78125rem] leading-[1.5] text-ink-2">
              {say(
                'A personal model overrides the council pool: this expert always thinks with it, whoever else is summoned.',
                'Личная модель важнее пула: этот специалист всегда думает ею, кого бы ещё ни созвали.',
              )}
              {myMeta?.quarantined
                ? ` ${say('It is below the reliability bar right now, so the council skips it — check the models page.', 'Сейчас она ниже планки надёжности, и совет её обходит — загляни на страницу моделей.')}`
                : ''}
            </p>
            {alsoOnModel.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-muted">
                <span>{say('Also on it:', 'На ней же:')}</span>
                {alsoOnModel.map((h) => (
                  <span key={`${h.kind}-${h.label}`} className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-ink-2">
                    {h.label}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-[0.78125rem] leading-[1.5] text-ink-2">
            {say(
              'No personal model: he takes one from the council pool in turn. Pick one below only when this craft needs a specific model — the pool already mixes vendors on purpose.',
              'Личной модели нет: берёт очередную из пула совета. Своя нужна, только если ремесло требует конкретной модели — пул и так намеренно смешивает вендоров.',
            )}
          </p>
        )}
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
