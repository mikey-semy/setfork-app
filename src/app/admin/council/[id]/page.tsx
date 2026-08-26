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
  const [{ buildOpts }, { modelMeta }, { builtinAvatars }] = await Promise.all([
    import('@/features/admin/model-options'),
    import('@/features/admin/model-enrich'),
    import('@/shared/ai/avatar-gallery'),
  ])
  const meta = await modelMeta(models?.currency ?? 'USD', ru)
  const modelOptions = models ? buildOpts(models.chat, false, lang, models.currency, models.pricesKnown, meta) : []
  // Чем думает ЭТОТ специалист: его модель, наш опыт с ней и кто ещё на ней сидит.
  const myMeta = e.model ? meta.get(baseModelId(e.model)) : undefined
  const alsoOnModel = (myMeta?.holders ?? []).filter((h) => h.gnomeId !== e.id)
  const gallery = await builtinAvatars()

  const name = ru ? e.nameRu : e.nameEn
  // Карта уже отрезолвлена по реальным файлам (rosterAvatars); пусто → заглушка GnomeAvatar.
  const avatarUrl = avatars[e.id]
  const acceptShare = kpi.gens ? Math.round((kpi.accepted / kpi.gens) * 100) : null
  // Настроение (RPG-развитие): демеанор из послужного списка — в стиль общения.
  const thanksN = (await gnomeThanksCounts())[e.id] ?? 0
  const mood = gnomeMood({ [e.id]: { gens: kpi.gens, accepted: kpi.accepted } }, e.id, thanksN)
  const moodEmoji: Record<string, string> = { elated: '😄', content: '🙂', settled: '😐', wary: '😟', grumpy: '😾' }

  // min-w-0: у элемента грида ширина по умолчанию не меньше его min-content, и
  // карточка с длинным текстом распирала бы колонку даже при grid-cols-1.
  const card = 'min-w-0 rounded-lg border border-border bg-surface p-4'
  const kpiCell = (icon: ReactNode, label: string, value: string, sub?: string) => (
    <div className={card}>
      <div className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-muted">
        {icon} {label}
      </div>
      <div className="mt-1.5 text-stat font-bold text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-body-sm text-ink-2">{sub}</div>}
    </div>
  )

  return (
    <div className="flex w-full min-w-0 flex-col px-5 py-6 md:px-8">
      <Link href="/admin/council" className="mb-4 inline-flex items-center gap-2 text-body text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> {t('admin.councilHall', lang)}
      </Link>

      <div className="mb-5 flex items-center gap-4">
        {/* Аватар из ростера: загруженный URL или встроенный webp; пусто → заглушка без 404. */}
        <GnomeAvatar src={avatarUrl} size={64} className="size-16 rounded-full border border-border object-cover" />
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-heading font-bold text-ink">
            {name}
            {!e.enabled && (
              <span className="rounded-md border border-border px-1.5 py-0.5 text-caption font-medium text-muted">{t('admin.disabled', lang)}</span>
            )}
          </h1>
          {(ru ? e.guildRu : e.guildEn) && <div className="mt-0.5 text-body font-medium text-accent">{ru ? e.guildRu : e.guildEn}</div>}
          {/* Аккаунт специалиста — то, что видят люди: списки, комментарии, авторство. */}
          {handle ? (
            <Link href={`/${handle}`} className="mt-0.5 inline-flex items-center gap-1 text-body-sm text-ink-2 hover:text-accent">
              <CircleUser size={12} /> @{handle}
            </Link>
          ) : (
            <div className="mt-0.5 inline-flex items-center gap-1 text-body-sm text-warn">
              <CircleUser size={12} /> {t('admin.noAccountYetCreate', lang)}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {/* Настроение гнома (RPG): вытекает из принятости, окрашивает его реплики. */}
            <Tooltip label={mood.style || t('admin.notEnoughDataYet', lang)}>
              <span tabIndex={0} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-caption text-ink-2">
                {moodEmoji[mood.label] ?? '😐'} {ru ? mood.labelRu : mood.label}
              </span>
            </Tooltip>
            {e.domains.map((d) => (
              <span key={d} className="rounded-full border border-border px-2 py-0.5 text-caption text-ink-2">
                {d}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpiCell(
          <Users size={13} />,
          t('admin.councilRounds', lang),
          String(kpi.rounds30d),
          t('admin.days30Total', lang).replace('{n}', String(kpi.roundsTotal)),
        )}
        {kpiCell(
          <CheckCircle2 size={13} />,
          t('admin.listsAccepted', lang),
          acceptShare === null ? '—' : `${kpi.accepted} (${acceptShare}%)`,
          t('admin.ofGensWithHim', lang).replace('{n}', String(kpi.gens)),
        )}
        {kpiCell(
          <BookOpen size={13} />,
          t('admin.knowledgeBase', lang),
          String(kpi.knowledge),
          t('admin.publicListsHisDomains', lang),
        )}
        {kpiCell(
          <Gauge size={13} />,
          t('admin.personalModel', lang),
          kpi.model ? `${Math.round(kpi.model.okRate * 100)}%` : '—',
          e.model
            ? kpi.model
              ? t('admin.modelCalls7d', lang).replace('{m}', prettyModelName(e.model)).replace('{n}', String(kpi.model.calls)).replace('{s}', (kpi.model.avgMs / 1000).toFixed(1))
              : t('admin.modelNoCalls7d', lang).replace('{m}', prettyModelName(e.model))
            : t('admin.usesCouncilPool', lang),
        )}
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className={card}>
          <div className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted">{t('admin.personaWorkingFrame', lang)}</div>
          <p className="whitespace-pre-wrap text-body leading-[1.55] text-ink-2 [overflow-wrap:anywhere]">{e.persona}</p>
          {e.code && (
            <>
              <div className="mb-2 mt-4 text-caption font-semibold uppercase tracking-wide text-muted">{t('common.guildCode', lang)}</div>
              {/* Людям — на их языке; агентам всегда едет EN `code`. */}
              <p className="whitespace-pre-wrap font-mono text-body-sm leading-[1.55] text-ink-2 [overflow-wrap:anywhere]">{(ru ? e.codeRu : '') || e.code}</p>
            </>
          )}
          {e.memory && (
            <>
              <div className="mb-2 mt-4 text-caption font-semibold uppercase tracking-wide text-muted">{t('admin.craftMemoryAutoDistilled', lang)}</div>
              <p className="whitespace-pre-wrap text-body-sm leading-[1.55] text-ink-2 [overflow-wrap:anywhere]">{e.memory}</p>
            </>
          )}

        </div>
        <div className={card}>
          <div className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted">{t('admin.recentCouncils', lang)}</div>
          {kpi.recent.length === 0 ? (
            <p className="text-body text-muted">{t('admin.hasNotBeenSummoned', lang)}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {kpi.recent.map((r, i) => (
                <li key={i} className="flex items-baseline gap-2 text-body">
                  <span className={`shrink-0 ${r.accepted ? 'text-ok' : 'text-muted'}`}>{r.accepted ? '✓' : '·'}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{r.query}</span>
                  <span className="shrink-0 whitespace-nowrap text-caption text-muted">{timeAgo(r.createdAt, lang)}</span>
                </li>
              ))}
            </ul>
          )}
          {kpi.lastSeenAt && (
            <div className="mt-2 text-caption text-muted">
              {t('admin.lastDraft', lang)} {timeAgo(kpi.lastSeenAt, lang)}
            </div>
          )}
        </div>
      </div>

      {/* ЧЕМ ДУМАЕТ — рядом с формой, где эту модель и меняют. Без блока «модель» была просто
          строкой в селекте: непонятно, что она делает, чего стоит и что будет, если оставить пусто. */}
      <div className={`${card} mb-5`}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-caption font-semibold uppercase tracking-wide text-muted">{t('admin.thinksWith', lang)}</span>
          <Link href="/admin/models" className="ml-auto inline-flex min-h-11 items-center gap-1 text-body-sm text-ink-2 hover:text-accent">
            <Cpu size={13} /> {t('admin.allModels', lang)}
          </Link>
        </div>
        {e.model ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-title font-semibold text-ink">{prettyModelName(e.model)}</span>
              {myMeta?.okPct != null && (
                <span className={`tabular-nums text-body-sm ${myMeta.quarantined ? 'text-danger' : 'text-ok'}`}>
                  {myMeta.okPct}% · {myMeta.calls}
                </span>
              )}
              {myMeta?.ourCost && <span className="tabular-nums text-body-sm text-muted">{t('admin.perCall', lang).replace('{c}', myMeta.ourCost)}</span>}
              {myMeta?.p95 && <span className="tabular-nums text-body-sm text-muted">p95 {myMeta.p95}</span>}
            </div>
            <p className="mt-1.5 text-body-sm leading-[1.5] text-ink-2">
              {t('admin.personalModelWins', lang)}
              {myMeta?.quarantined
                ? ` ${t('admin.modelQuarantined', lang)}`
                : ''}
            </p>
            {alsoOnModel.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-caption text-muted">
                <span>{t('admin.alsoOnIt', lang)}</span>
                {alsoOnModel.map((h) => (
                  <span key={`${h.kind}-${h.label}`} className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-ink-2">
                    {h.label}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-body-sm leading-[1.5] text-ink-2">
            {t('admin.noPersonalModel', lang)}
          </p>
        )}
      </div>

      {/* НАСТРОЙКИ — здесь, а не в общем зале: у списка настройки на странице списка, у
          специалиста на его странице. Одна форма на одного, а не стена из двадцати. */}
      <div className="mt-5">
        <div className="mb-2 text-body font-semibold uppercase tracking-wide text-ink-2">{t('admin.settings', lang)}</div>
        <ExpertSettings e={{ ...e, uploadedUrl: e.avatarUploaded ? avatars[e.id] : undefined }} modelOptions={modelOptions} gallery={gallery} lang={lang} />
      </div>
    </div>
  )
}
